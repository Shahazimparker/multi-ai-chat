const { searchUserFilesRAG, getFileContent } = require('./fileUpload.service');
const { searchWeb } = require('./tools/webSearch.service');
const { generateImage } = require('./imageGeneration.service');
const { generatePPT } = require('./pptGeneration.service');
const { generatePDF } = require('./pdfGeneration.service');
const { generateExcel } = require('./excelGeneration.service');
const { generateDocx } = require('./wordGeneration.service');
const { generateCSV } = require('./csvGeneration.service');
const { generateChart } = require('./chartGeneration.service');
const { generateHTML } = require('./htmlGeneration.service');
const { generateJSON } = require('./jsonGeneration.service');
const { generateMarkdown } = require('./markdownGeneration.service');
const { approvalManager } = require('./approvalManager.shared');

/**
 * Wait for approval with polling (non-blocking runtime compatibility)
 */
const POLL_INTERVAL_MS = 500;
const APPROVAL_TIMEOUT_MS = 120000; // 2 minutes

const waitForUserApproval = async (requestId, abortSignal) => {
  const handler = approvalManager.getHandler('default');
  const startTime = Date.now();

  while (Date.now() - startTime < APPROVAL_TIMEOUT_MS) {
    if (abortSignal?.aborted) return { approved: false, reason: 'aborted' };

    try {
      const request = await handler.getRequest(requestId);
      if (!request) {
        // Try loading from DB
        const loaded = await handler._loadRequest(requestId);
        if (!loaded) {
          await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
          continue;
        }
      }

      if (request?.status === 'approved') {
        const instructions = (request.reason && request.reason !== 'Approved from chat') ? request.reason : '';
        return { approved: true, reason: '', instructions };
      }
      if (request?.status === 'rejected') return { approved: false, reason: request.reason || 'Rejected by user' };
      if (request?.status === 'expired') return { approved: false, reason: 'Approval timed out' };
    } catch (err) {
      console.warn('[ToolProcessor] Approval poll error:', err.message);
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  return { approved: false, reason: 'Approval timed out' };
};

const buildSummary = (toolName, context) => {
  const lines = [];
  switch (toolName) {
    case 'GENERATE_IMAGE':
      if (context.prompt) lines.push(`Prompt: "${context.prompt}"`);
      break;
    case 'GENERATE_PPT':
      lines.push(`Title: "${context.title || 'Untitled'}"`);
      if (context.theme) lines.push(`Theme: ${context.theme}`);
      if (Array.isArray(context.slides) && context.slides.length > 0) {
        lines.push(`Slides (${context.slides.length}):`);
        context.slides.slice(0, 8).forEach((s, i) => lines.push(`  ${i + 1}. ${s.title || s}`));
        if (context.slides.length > 8) lines.push(`  … and ${context.slides.length - 8} more`);
      }
      break;
    case 'GENERATE_PDF':
      lines.push(`Title: "${context.title || 'Document'}"`);
      if (Array.isArray(context.sections) && context.sections.length > 0) {
        lines.push(`Sections (${context.sections.length}):`);
        context.sections.slice(0, 6).forEach((s, i) => lines.push(`  ${i + 1}. ${s.heading || s.title || s.name || `Section ${i + 1}`}`));
        if (context.sections.length > 6) lines.push(`  … and ${context.sections.length - 6} more`);
      }
      break;
    case 'GENERATE_EXCEL':
      lines.push(`Title: "${context.title || 'Spreadsheet'}"`);
      if (Array.isArray(context.sheets) && context.sheets.length > 0) {
        lines.push(`Sheets (${context.sheets.length}): ${context.sheets.map(s => s.name || s.title || 'Sheet').join(', ')}`);
      }
      break;
    case 'GENERATE_DOCX':
      lines.push(`Title: "${context.title || 'Document'}"`);
      if (Array.isArray(context.sections) && context.sections.length > 0) {
        lines.push(`Sections (${context.sections.length}):`);
        context.sections.slice(0, 6).forEach((s, i) => lines.push(`  ${i + 1}. ${s.heading || s.title || s.name || `Section ${i + 1}`}`));
        if (context.sections.length > 6) lines.push(`  … and ${context.sections.length - 6} more`);
      }
      break;
    case 'GENERATE_CSV':
      if (Array.isArray(context.headers) && context.headers.length > 0)
        lines.push(`Columns (${context.headers.length}): ${context.headers.join(', ')}`);
      if (context.rowCount !== undefined) lines.push(`Rows: ${context.rowCount}`);
      break;
    case 'GENERATE_CHART':
      if (context.type) lines.push(`Type: ${context.type}`);
      if (context.title) lines.push(`Title: "${context.title}"`);
      if (Array.isArray(context.labels) && context.labels.length > 0)
        lines.push(`Data points: ${context.labels.slice(0, 6).join(', ')}${context.labels.length > 6 ? '…' : ''}`);
      break;
    case 'GENERATE_HTML':
      if (context.title) lines.push(`Title: "${context.title}"`);
      break;
    case 'GENERATE_JSON':
      lines.push('JSON data file');
      break;
    case 'GENERATE_MD':
      if (context.title) lines.push(`Title: "${context.title}"`);
      lines.push('Markdown document');
      break;
    default:
      break;
  }
  return lines.join('\n');
};

const makeInstructionsResult = (matchStr, reply, toolName, instructions) => ({
  handled: true,
  newMessages: [
    { role: 'assistant', content: (matchStr ? reply.replace(matchStr, '').trim() : reply.trim()) || `[${toolName} generation paused for revision]` },
    { role: 'user', content: `[USER MODIFICATION REQUEST]\nUser approved but requested these changes before generating:\n"${instructions}"\nPlease revise your plan to incorporate these changes and regenerate.\n[END USER MODIFICATION REQUEST]` },
  ],
  embedTokens: 0,
});

/**
 * Request human approval before executing a generation tool
 */
const requestToolApproval = async (toolName, context, onStatus, abortSignal = null) => {
  const toolLabels = {
    GENERATE_PPT: 'PowerPoint presentation',
    GENERATE_IMAGE: 'image',
    GENERATE_HTML: 'HTML page',
    GENERATE_PDF: 'PDF document',
    GENERATE_EXCEL: 'Excel spreadsheet',
    GENERATE_DOCX: 'Word document',
    GENERATE_CHART: 'chart',
    GENERATE_CSV: 'CSV file',
    GENERATE_JSON: 'JSON file',
    GENERATE_MD: 'Markdown file',
  };

  const toolLabel = toolLabels[toolName] || toolName;

  try {
    const request = await approvalManager.getHandler('default').requestApproval({
      type: 'approval',
      title: `Generate ${toolLabel}`,
      description: `The AI wants to generate a ${toolLabel}. Click approve to continue or cancel to stop.`,
      context: { tool: toolName, ...context },
      timeout: APPROVAL_TIMEOUT_MS,
      requiredBy: 'chat-user',
    });

    // Emit SSE event for frontend to show approval prompt
    if (onStatus) {
      onStatus({
        type: 'approval_request',
        approvalId: request.id,
        toolType: toolName,
        toolLabel,
        message: `I want to generate a ${toolLabel}. Review the plan below and approve, cancel, or request changes.`,
        summary: buildSummary(toolName, context),
        options: ['yes', 'other', 'no'],
      });
    }

    const result = await waitForUserApproval(request.id, abortSignal);

    if (!result.approved) {
      console.log(`[ToolProcessor] Tool ${toolName} ${result.reason || 'not approved'}`);
    }

    return result;
  } catch (err) {
    console.error(`[ToolProcessor] Approval request failed for ${toolName}:`, err.message);
    return { approved: true, reason: '' }; // Fall through on error
  }
};

const buildFileContext = (fileResults, totalFileCount) => {
  const fileCountNote = totalFileCount > fileResults.length
    ? `\n(Showing ${fileResults.length} of ${totalFileCount} total files — use SEARCH_FILES to find older ones)`
    : '';

  return fileResults.length > 0
    ? `[AVAILABLE UPLOADED FILES]\n${fileResults
      .map(r => `- ${r.file_name} (id: ${r.file_id})`)
      .join('\n')}${fileCountNote}\n[END UPLOADED FILES]\n\n` +
    `You have access to two tools for uploaded files:\n` +
    `1. SEARCH_FILES — use when the user asks what a file contains or which file has specific data. ` +
    `Respond with: [SEARCH_FILES:query=<search text>] and I will return brief snippets of matching files.\n` +
    `2. GET_FILE — use when you need the full content of a specific file. ` +
    `Respond with: [GET_FILE:id=<file_id>] and I will inject the full content.`
    : '';
};

const findSearchFileMatch = (reply) => reply.match(/\[SEARCH_FILES:query=([^\]]+)\]/);
const findGetFileMatch = (reply) => reply.match(/\[GET_FILE:id=([^\]]+)\]/);
const findWebSearchMatch = (reply) => reply.match(/\[WEB_SEARCH:query=(?:"|')([^"']+)(?:"|')\]/i) || reply.match(/\[WEB_SEARCH:([^\]]+)\]/i);
const findGenerateImageMatch = (reply) => reply.match(/\[GENERATE_IMAGE:prompt=([^\]]+)\]/i);
const findGeneratePPTMatch = (reply) => reply.match(/\[GENERATE_PPT\]([\s\S]*?)\[\/GENERATE_PPT\]/i);
const findGeneratePDFMatch = (reply) => reply.match(/\[GENERATE_PDF\]([\s\S]*?)\[\/GENERATE_PDF\]/i);
const findGenerateExcelMatch = (reply) => reply.match(/\[GENERATE_EXCEL\]([\s\S]*?)\[\/GENERATE_EXCEL\]/i);
const findGenerateDocxMatch = (reply) => reply.match(/\[GENERATE_DOCX\]([\s\S]*?)\[\/GENERATE_DOCX\]/i);
const findGenerateCSVMatch = (reply) => reply.match(/\[GENERATE_CSV\]([\s\S]*?)\[\/GENERATE_CSV\]/i);
const findGenerateChartMatch = (reply) => reply.match(/\[GENERATE_CHART\]([\s\S]*?)\[\/GENERATE_CHART\]/i);
const findGenerateHTMLMatch = (reply) => reply.match(/\[GENERATE_HTML\]([\s\S]*?)\[\/GENERATE_HTML\]/i);
const findGenerateJSONMatch = (reply) => reply.match(/\[GENERATE_JSON\]([\s\S]*?)\[\/GENERATE_JSON\]/i);
const findGenerateMDMatch = (reply) => reply.match(/\[GENERATE_MD\]([\s\S]*?)\[\/GENERATE_MD\]/i);

const runPPTGeneration = async ({ parsed, reply = '', user, topicId, onStatus, consumedText = '' }) => {
  onStatus?.({ type: 'status', tool: 'ppt_gen', message: 'Generating PowerPoint presentation...' });
  console.log('[Tool] PPT generation requested');
  const title = parsed?.title || 'Presentation';
  const slides = Array.isArray(parsed?.slides) ? parsed.slides : [];
  if (slides.length === 0) throw new Error('No slides provided in PPT request.');

  const theme = parsed?.theme || parsed?.style || 'modern_corporate';
  const fileResult = await generatePPT(title, slides, user?.id, topicId, { subtitle: parsed?.subtitle, theme });
  const resultBlock = `[PPT GENERATION RESULT]\nPresentation successfully created.\nTitle: ${title}\nTheme: ${theme}\nSlides: ${slides.length}\nFile: ${fileResult.file_name}\nFile ID: ${fileResult.file_id}\n[END PPT GENERATION RESULT]\n\nTell the user the presentation is ready to download and give a brief summary of what was included.`;
  return {
    handled: true,
    generatedMedia: [{ file_id: fileResult.file_id, file_name: fileResult.file_name, file_type: 'pptx' }],
    newMessages: [
      { role: 'assistant', content: (consumedText ? reply.replace(consumedText, '').trim() : reply.trim()) || '[Generating PowerPoint]' },
      { role: 'user', content: resultBlock },
    ],
    embedTokens: 0,
  };
};

const processToolCall = async ({
  reply,
  aiResponse,
  aiMessages,
  user,
  topicId,
  abortController,
  onStatus = null,
  forceWebSearch = true,
}) => {
  const searchMatch = findSearchFileMatch(reply);
  if (searchMatch) {
    const query = searchMatch[1].trim();
    const searchResult = await searchUserFilesRAG(query, user?.id, topicId, abortController.signal);
    const searchResults = searchResult.results || [];
    const embedTokens = searchResult.embedTokens || 0;

    const resultBlock = searchResults.length > 0
      ? `[SEARCH RESULTS for "${query}"]\n${searchResults
        .map(r => `- ${r.file_name} (id: ${r.file_id}): ${r.chunk_text.slice(0, 300)}`)
        .join('\n')}\n[END SEARCH RESULTS]`
      : `[SEARCH RESULTS for "${query}"]\nNo matching files found.\n[END SEARCH RESULTS]`;

    return {
      handled: true,
      newMessages: [
        { role: 'assistant', content: reply.replace(searchMatch[0], '').trim() || `[Searching files for "${query}"]` },
        { role: 'user', content: resultBlock },
      ],
      embedTokens,
    };
  }

  const getFileMatch = findGetFileMatch(reply);
  if (getFileMatch) {
    const fileId = getFileMatch[1].trim();
    const fileData = await getFileContent(fileId, user?.id, topicId);

    if (!fileData) {
      return {
        handled: true,
        newMessages: [
          { role: 'assistant', content: reply },
          { role: 'user', content: `[Tool Result] File with id "${fileId}" not found or access denied.` },
        ],
        embedTokens: 0,
      };
    }

    const fileContent = fileData.original_content || fileData.llm_analysis || '[No content available]';
    const contentBlock = `[FILE CONTENT: ${fileData.file_name}]\n\`\`\`\n${fileContent}\n\`\`\`\n[END FILE CONTENT]\n\nNow answer the user's question based on this file content. Be concise and accurate.`;

    return {
      handled: true,
      newMessages: [
        { role: 'assistant', content: reply.replace(getFileMatch[0], '').trim() || `[Requesting file: ${fileData.file_name}]` },
        { role: 'user', content: contentBlock },
      ],
      embedTokens: 0,
    };
  }

  const webSearchMatch = findWebSearchMatch(reply);
  if (webSearchMatch) {
    if (!forceWebSearch) {
      return {
        handled: true,
        newMessages: [
          { role: 'assistant', content: reply.replace(webSearchMatch[0], '').trim() || '[web search]' },
          { role: 'user', content: '[WEB SEARCH RESULT]\nWeb search is disabled for this conversation. Please answer the user\'s question using your existing knowledge without searching the web.\n[END WEB SEARCH RESULT]' },
        ],
        embedTokens: 0,
      };
    }

    const query = webSearchMatch[1].trim();
    onStatus?.({
      type: 'status',
      tool: 'web_search',
      message: 'searching on web',
    });
    console.log(`[Tool] Web search requested (${query.length} chars)`);
    const results = await searchWeb(query);
    console.log(`[Tool] Web search returned ${results.length} result(s)`);

    const resultBlock = results.length > 0
      ? `[WEB SEARCH RESULTS for "${query}"]\n${results.map(r => `- [${r.title}](${r.url}): ${r.snippet}`).join('\n')}\n[END WEB SEARCH RESULTS]\n\nNow answer the user's question based on these results.`
      : `[WEB SEARCH RESULTS for "${query}"]\nNo results found.\n[END WEB SEARCH RESULTS]`;

    return {
      handled: true,
      newMessages: [
        { role: 'assistant', content: reply.replace(webSearchMatch[0], '').trim() || '[searching on web]' },
        { role: 'user', content: resultBlock },
      ],
      embedTokens: 0,
    };
  }

  // ── GENERATE_IMAGE handler ────────────────────────────────
  const generateImageMatch = findGenerateImageMatch(reply);
  if (generateImageMatch) {
    const prompt = generateImageMatch[1].trim();

    // Request human approval before executing
    const approval = await requestToolApproval('GENERATE_IMAGE', { prompt }, onStatus, abortController?.signal);
    if (!approval.approved) {
      return { handled: true, newMessages: [{ role: 'assistant', content: reply.replace(generateImageMatch[0], '').trim() || '[Image generation]' }, { role: 'user', content: `[IMAGE GENERATION RESULT]\nImage generation was ${approval.reason || 'cancelled'}.\n[END IMAGE GENERATION RESULT]` }], embedTokens: 0 };
    }
    if (approval.instructions) return makeInstructionsResult(generateImageMatch[0], reply, 'GENERATE_IMAGE', approval.instructions);

    onStatus?.({ type: 'status', tool: 'image_gen', message: `Generating image: "${prompt.slice(0, 60)}..."` });
    console.log(`[Tool] Image generation requested: "${prompt.slice(0, 80)}"`);
    try {
      const fileResult = await generateImage(prompt, user?.id, topicId);
      const resultBlock = `[IMAGE GENERATION RESULT]\nImage successfully generated and saved.\nFile: ${fileResult.file_name}\nFile ID: ${fileResult.file_id}\n[END IMAGE GENERATION RESULT]\n\nDescribe the image you just generated based on the prompt and let the user know it is ready to download.`;
      return {
        handled: true,
        generatedMedia: [{ file_id: fileResult.file_id, file_name: fileResult.file_name, file_type: 'png' }],
        newMessages: [
          { role: 'assistant', content: reply.replace(generateImageMatch[0], '').trim() || `[Generating image: "${prompt}"]` },
          { role: 'user', content: resultBlock },
        ],
        embedTokens: 0,
      };
    } catch (err) {
      console.error('[Tool] Image generation failed:', err.message);
      const errBlock = `[IMAGE GENERATION RESULT]\nFailed to generate image: ${err.message}\n[END IMAGE GENERATION RESULT]`;
      return {
        handled: true,
        generatedMedia: [],
        newMessages: [
          { role: 'assistant', content: reply.replace(generateImageMatch[0], '').trim() || '[Generating image]' },
          { role: 'user', content: errBlock },
        ],
        embedTokens: 0,
      };
    }
  }

  // ── GENERATE_PPT handler ──────────────────────────────────
  const toolCalls = Array.isArray(aiResponse?.toolCalls) ? aiResponse.toolCalls : [];
  const pptToolCall = toolCalls.find((tc) => tc?.type === 'function' && tc?.function?.name === 'generate_ppt');
  if (pptToolCall) {
    try {
      const parsed = JSON.parse(String(pptToolCall.function.arguments || '{}'));
      const pptApproval = await requestToolApproval('GENERATE_PPT', { title: parsed?.title, theme: parsed?.theme || parsed?.style, slides: parsed?.slides }, onStatus, abortController?.signal);
      if (!pptApproval.approved) {
        return { handled: true, newMessages: [{ role: 'assistant', content: reply.trim() || '[PPT generation]' }, { role: 'user', content: `[PPT GENERATION RESULT]\nPresentation generation was ${pptApproval.reason || 'cancelled'}.\n[END PPT GENERATION RESULT]` }], embedTokens: 0 };
      }
      if (pptApproval.instructions) return makeInstructionsResult(null, reply, 'GENERATE_PPT', pptApproval.instructions);
      return await runPPTGeneration({ parsed, reply, user, topicId, onStatus });
    } catch (err) {
      console.error('[Tool] PPT generation failed:', err.message);
      const errBlock = `[PPT GENERATION RESULT]\nFailed to generate presentation: ${err.message}\n[END PPT GENERATION RESULT]`;
      return {
        handled: true,
        generatedMedia: [],
        newMessages: [
          { role: 'assistant', content: reply.trim() || '[Generating PPT]' },
          { role: 'user', content: errBlock },
        ],
        embedTokens: 0,
      };
    }
  }

  const generatePPTMatch = findGeneratePPTMatch(reply);
  if (generatePPTMatch) {
    const jsonBody = generatePPTMatch[1].trim();
    let parsed;
    try {
      parsed = JSON.parse(jsonBody);
    } catch {
      return {
        handled: true,
        newMessages: [
          { role: 'assistant', content: reply.trim() || '[Generating PPT]' },
          { role: 'user', content: `[PPT GENERATION RESULT]\nFailed to generate presentation: Invalid JSON structure.\n[END PPT GENERATION RESULT]` },
        ],
        embedTokens: 0,
      };
    }

    // Request human approval before executing
    const approval = await requestToolApproval('GENERATE_PPT', { title: parsed?.title, theme: parsed?.theme || parsed?.style, slides: parsed?.slides }, onStatus, abortController?.signal);
    if (!approval.approved) {
      return { handled: true, newMessages: [{ role: 'assistant', content: reply.replace(generatePPTMatch[0], '').trim() || '[PPT generation]' }, { role: 'user', content: `[PPT GENERATION RESULT]\nPresentation generation was ${approval.reason || 'cancelled'}.\n[END PPT GENERATION RESULT]` }], embedTokens: 0 };
    }
    if (approval.instructions) return makeInstructionsResult(generatePPTMatch[0], reply, 'GENERATE_PPT', approval.instructions);

    try {
      return await runPPTGeneration({
        parsed,
        reply,
        user,
        topicId,
        onStatus,
        consumedText: generatePPTMatch[0],
      });
    } catch (err) {
      console.error('[Tool] PPT generation failed:', err.message);
      const errBlock = `[PPT GENERATION RESULT]\nFailed to generate presentation: ${err.message}\n[END PPT GENERATION RESULT]`;
      return {
        handled: true,
        generatedMedia: [],
        newMessages: [
          { role: 'assistant', content: reply.replace(generatePPTMatch[0], '').trim() || '[Generating PPT]' },
          { role: 'user', content: errBlock },
        ],
        embedTokens: 0,
      };
    }
  }

  const generatePDFMatch = findGeneratePDFMatch(reply);
  if (generatePDFMatch) {
    const jsonBody = generatePDFMatch[1].trim();
    onStatus?.({ type: 'status', tool: 'pdf_gen', message: 'Generating PDF document...' });
    console.log('[Tool] PDF generation requested');
    try {
      let parsed;
      try { parsed = JSON.parse(jsonBody); } catch { throw new Error('Invalid PDF JSON structure.'); }
      const title = parsed.title || 'Document';
      const sections = Array.isArray(parsed.sections) ? parsed.sections : [];
      if (sections.length === 0) throw new Error('No sections provided in PDF request.');

      const pdfApproval = await requestToolApproval('GENERATE_PDF', { title, sections }, onStatus, abortController?.signal);
      if (!pdfApproval.approved) {
        return { handled: true, newMessages: [{ role: 'assistant', content: reply.replace(generatePDFMatch[0], '').trim() || '[PDF generation]' }, { role: 'user', content: `[PDF GENERATION RESULT]\nPDF generation was ${pdfApproval.reason || 'cancelled'}.\n[END PDF GENERATION RESULT]` }], embedTokens: 0 };
      }
      if (pdfApproval.instructions) return makeInstructionsResult(generatePDFMatch[0], reply, 'GENERATE_PDF', pdfApproval.instructions);

      const fileResult = await generatePDF(title, sections, user?.id, topicId);
      const resultBlock = `[PDF GENERATION RESULT]\nPDF successfully created.\nTitle: ${title}\nSections: ${sections.length}\nFile: ${fileResult.file_name}\nFile ID: ${fileResult.file_id}\n[END PDF GENERATION RESULT]\n\nTell the user the PDF is ready to download.`;
      return { handled: true, generatedMedia: [{ file_id: fileResult.file_id, file_name: fileResult.file_name, file_type: 'pdf' }], newMessages: [{ role: 'assistant', content: reply.replace(generatePDFMatch[0], '').trim() || '[Generating PDF]' }, { role: 'user', content: resultBlock }], embedTokens: 0 };
    } catch (err) {
      console.error('[Tool] PDF generation failed:', err.message);
      const errBlock = `[PDF GENERATION RESULT]\nFailed to generate PDF: ${err.message}\n[END PDF GENERATION RESULT]`;
      return { handled: true, generatedMedia: [], newMessages: [{ role: 'assistant', content: reply.replace(generatePDFMatch[0], '').trim() || '[Generating PDF]' }, { role: 'user', content: errBlock }], embedTokens: 0 };
    }
  }

  // ── GENERATE_EXCEL handler ────────────────────────────────
  const generateExcelMatch = findGenerateExcelMatch(reply);
  if (generateExcelMatch) {
    const jsonBody = generateExcelMatch[1].trim();
    onStatus?.({ type: 'status', tool: 'excel_gen', message: 'Generating Excel spreadsheet...' });
    console.log('[Tool] Excel generation requested');
    try {
      let parsed;
      try { parsed = JSON.parse(jsonBody); } catch { throw new Error('Invalid Excel JSON structure.'); }
      const title = parsed.title || 'Spreadsheet';
      const sheets = Array.isArray(parsed.sheets) ? parsed.sheets : [];
      if (sheets.length === 0) throw new Error('No sheets provided in Excel request.');

      const excelApproval = await requestToolApproval('GENERATE_EXCEL', { title, sheets }, onStatus, abortController?.signal);
      if (!excelApproval.approved) {
        return { handled: true, newMessages: [{ role: 'assistant', content: reply.replace(generateExcelMatch[0], '').trim() || '[Excel generation]' }, { role: 'user', content: `[EXCEL GENERATION RESULT]\nSpreadsheet generation was ${excelApproval.reason || 'cancelled'}.\n[END EXCEL GENERATION RESULT]` }], embedTokens: 0 };
      }
      if (excelApproval.instructions) return makeInstructionsResult(generateExcelMatch[0], reply, 'GENERATE_EXCEL', excelApproval.instructions);

      const fileResult = await generateExcel(title, sheets, user?.id, topicId);
      const resultBlock = `[EXCEL GENERATION RESULT]\nSpreadsheet successfully created.\nTitle: ${title}\nSheets: ${sheets.length}\nFile: ${fileResult.file_name}\nFile ID: ${fileResult.file_id}\n[END EXCEL GENERATION RESULT]\n\nTell the user the spreadsheet is ready to download.`;
      return { handled: true, generatedMedia: [{ file_id: fileResult.file_id, file_name: fileResult.file_name, file_type: 'xlsx' }], newMessages: [{ role: 'assistant', content: reply.replace(generateExcelMatch[0], '').trim() || '[Generating Excel]' }, { role: 'user', content: resultBlock }], embedTokens: 0 };
    } catch (err) {
      console.error('[Tool] Excel generation failed:', err.message);
      const errBlock = `[EXCEL GENERATION RESULT]\nFailed to generate spreadsheet: ${err.message}\n[END EXCEL GENERATION RESULT]`;
      return { handled: true, generatedMedia: [], newMessages: [{ role: 'assistant', content: reply.replace(generateExcelMatch[0], '').trim() || '[Generating Excel]' }, { role: 'user', content: errBlock }], embedTokens: 0 };
    }
  }

  // ── GENERATE_DOCX handler ─────────────────────────────────
  const generateDocxMatch = findGenerateDocxMatch(reply);
  if (generateDocxMatch) {
    const jsonBody = generateDocxMatch[1].trim();
    onStatus?.({ type: 'status', tool: 'docx_gen', message: 'Generating Word document...' });
    console.log('[Tool] DOCX generation requested');
    try {
      let parsed;
      try { parsed = JSON.parse(jsonBody); } catch { throw new Error('Invalid DOCX JSON structure.'); }
      const title = parsed.title || 'Document';
      const sections = Array.isArray(parsed.sections) ? parsed.sections : [];
      if (sections.length === 0) throw new Error('No sections provided in DOCX request.');

      const docxApproval = await requestToolApproval('GENERATE_DOCX', { title, sections }, onStatus, abortController?.signal);
      if (!docxApproval.approved) {
        return { handled: true, newMessages: [{ role: 'assistant', content: reply.replace(generateDocxMatch[0], '').trim() || '[DOCX generation]' }, { role: 'user', content: `[DOCX GENERATION RESULT]\nDocument generation was ${docxApproval.reason || 'cancelled'}.\n[END DOCX GENERATION RESULT]` }], embedTokens: 0 };
      }
      if (docxApproval.instructions) return makeInstructionsResult(generateDocxMatch[0], reply, 'GENERATE_DOCX', docxApproval.instructions);

      const fileResult = await generateDocx(title, sections, user?.id, topicId);
      const resultBlock = `[DOCX GENERATION RESULT]\nWord document successfully created.\nTitle: ${title}\nSections: ${sections.length}\nFile: ${fileResult.file_name}\nFile ID: ${fileResult.file_id}\n[END DOCX GENERATION RESULT]\n\nTell the user the document is ready to download.`;
      return { handled: true, generatedMedia: [{ file_id: fileResult.file_id, file_name: fileResult.file_name, file_type: 'docx' }], newMessages: [{ role: 'assistant', content: reply.replace(generateDocxMatch[0], '').trim() || '[Generating DOCX]' }, { role: 'user', content: resultBlock }], embedTokens: 0 };
    } catch (err) {
      console.error('[Tool] DOCX generation failed:', err.message);
      const errBlock = `[DOCX GENERATION RESULT]\nFailed to generate document: ${err.message}\n[END DOCX GENERATION RESULT]`;
      return { handled: true, generatedMedia: [], newMessages: [{ role: 'assistant', content: reply.replace(generateDocxMatch[0], '').trim() || '[Generating DOCX]' }, { role: 'user', content: errBlock }], embedTokens: 0 };
    }
  }

  // ── GENERATE_CSV handler ──────────────────────────────────
  const generateCSVMatch = findGenerateCSVMatch(reply);
  if (generateCSVMatch) {
    const jsonBody = generateCSVMatch[1].trim();
    onStatus?.({ type: 'status', tool: 'csv_gen', message: 'Generating CSV file...' });
    console.log('[Tool] CSV generation requested');
    try {
      let parsed;
      try { parsed = JSON.parse(jsonBody); } catch { throw new Error('Invalid CSV JSON structure.'); }
      const headers = Array.isArray(parsed.headers) ? parsed.headers : [];
      const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
      if (headers.length === 0) throw new Error('No headers provided in CSV request.');

      const csvApproval = await requestToolApproval('GENERATE_CSV', { headers, rowCount: rows.length }, onStatus, abortController?.signal);
      if (!csvApproval.approved) {
        return { handled: true, newMessages: [{ role: 'assistant', content: reply.replace(generateCSVMatch[0], '').trim() || '[CSV generation]' }, { role: 'user', content: `[CSV GENERATION RESULT]\nCSV generation was ${csvApproval.reason || 'cancelled'}.\n[END CSV GENERATION RESULT]` }], embedTokens: 0 };
      }
      if (csvApproval.instructions) return makeInstructionsResult(generateCSVMatch[0], reply, 'GENERATE_CSV', csvApproval.instructions);

      const fileResult = await generateCSV(headers, rows, user?.id, topicId);
      const resultBlock = `[CSV GENERATION RESULT]\nCSV successfully created.\nRows: ${rows.length}\nFile: ${fileResult.file_name}\nFile ID: ${fileResult.file_id}\n[END CSV GENERATION RESULT]\n\nTell the user the CSV is ready to download.`;
      return { handled: true, generatedMedia: [{ file_id: fileResult.file_id, file_name: fileResult.file_name, file_type: 'csv' }], newMessages: [{ role: 'assistant', content: reply.replace(generateCSVMatch[0], '').trim() || '[Generating CSV]' }, { role: 'user', content: resultBlock }], embedTokens: 0 };
    } catch (err) {
      console.error('[Tool] CSV generation failed:', err.message);
      const errBlock = `[CSV GENERATION RESULT]\nFailed to generate CSV: ${err.message}\n[END CSV GENERATION RESULT]`;
      return { handled: true, generatedMedia: [], newMessages: [{ role: 'assistant', content: reply.replace(generateCSVMatch[0], '').trim() || '[Generating CSV]' }, { role: 'user', content: errBlock }], embedTokens: 0 };
    }
  }

  // ── GENERATE_CHART handler ────────────────────────────────
  const generateChartMatch = findGenerateChartMatch(reply);
  if (generateChartMatch) {
    const jsonBody = generateChartMatch[1].trim();
    onStatus?.({ type: 'status', tool: 'chart_gen', message: 'Generating chart...' });
    console.log('[Tool] Chart generation requested');
    try {
      let parsed;
      try { parsed = JSON.parse(jsonBody); } catch { throw new Error('Invalid Chart JSON structure.'); }
      const type = parsed.type || 'bar';
      const title = parsed.title || 'Chart';
      const labels = Array.isArray(parsed.labels) ? parsed.labels : [];
      const data = Array.isArray(parsed.data) ? parsed.data : [];
      if (labels.length === 0 || data.length === 0) throw new Error('Labels and data are required for chart.');

      const chartApproval = await requestToolApproval('GENERATE_CHART', { type, title, labels }, onStatus, abortController?.signal);
      if (!chartApproval.approved) {
        return { handled: true, newMessages: [{ role: 'assistant', content: reply.replace(generateChartMatch[0], '').trim() || '[Chart generation]' }, { role: 'user', content: `[CHART GENERATION RESULT]\nChart generation was ${chartApproval.reason || 'cancelled'}.\n[END CHART GENERATION RESULT]` }], embedTokens: 0 };
      }
      if (chartApproval.instructions) return makeInstructionsResult(generateChartMatch[0], reply, 'GENERATE_CHART', chartApproval.instructions);

      const fileResult = await generateChart(type, title, labels, data, user?.id, topicId);
      const resultBlock = `[CHART GENERATION RESULT]\nChart successfully created.\nType: ${type}\nTitle: ${title}\nFile: ${fileResult.file_name}\nFile ID: ${fileResult.file_id}\n[END CHART GENERATION RESULT]\n\nTell the user the chart is ready to download.`;
      return { handled: true, generatedMedia: [{ file_id: fileResult.file_id, file_name: fileResult.file_name, file_type: 'svg' }], newMessages: [{ role: 'assistant', content: reply.replace(generateChartMatch[0], '').trim() || '[Generating Chart]' }, { role: 'user', content: resultBlock }], embedTokens: 0 };
    } catch (err) {
      console.error('[Tool] Chart generation failed:', err.message);
      const errBlock = `[CHART GENERATION RESULT]\nFailed to generate chart: ${err.message}\n[END CHART GENERATION RESULT]`;
      return { handled: true, generatedMedia: [], newMessages: [{ role: 'assistant', content: reply.replace(generateChartMatch[0], '').trim() || '[Generating Chart]' }, { role: 'user', content: errBlock }], embedTokens: 0 };
    }
  }

  // ── GENERATE_HTML handler ─────────────────────────────────
  const generateHTMLMatch = findGenerateHTMLMatch(reply);
  if (generateHTMLMatch) {
    const jsonBody = generateHTMLMatch[1].trim();
    onStatus?.({ type: 'status', tool: 'html_gen', message: 'Generating HTML page...' });
    console.log('[Tool] HTML generation requested');
    try {
      let parsed;
      try { parsed = JSON.parse(jsonBody); } catch { throw new Error('Invalid HTML JSON structure.'); }
      const title = parsed.title || 'Page';
      const body = parsed.body || '';
      const css = parsed.css || '';

      const htmlApproval = await requestToolApproval('GENERATE_HTML', { title }, onStatus, abortController?.signal);
      if (!htmlApproval.approved) {
        return { handled: true, newMessages: [{ role: 'assistant', content: reply.replace(generateHTMLMatch[0], '').trim() || '[HTML generation]' }, { role: 'user', content: `[HTML GENERATION RESULT]\nHTML generation was ${htmlApproval.reason || 'cancelled'}.\n[END HTML GENERATION RESULT]` }], embedTokens: 0 };
      }
      if (htmlApproval.instructions) return makeInstructionsResult(generateHTMLMatch[0], reply, 'GENERATE_HTML', htmlApproval.instructions);

      const fileResult = await generateHTML(title, body, css, user?.id, topicId);
      const resultBlock = `[HTML GENERATION RESULT]\nHTML page successfully created.\nTitle: ${title}\nFile: ${fileResult.file_name}\nFile ID: ${fileResult.file_id}\n[END HTML GENERATION RESULT]\n\nTell the user the HTML page is ready to download.`;
      return { handled: true, generatedMedia: [{ file_id: fileResult.file_id, file_name: fileResult.file_name, file_type: 'html' }], newMessages: [{ role: 'assistant', content: reply.replace(generateHTMLMatch[0], '').trim() || '[Generating HTML]' }, { role: 'user', content: resultBlock }], embedTokens: 0 };
    } catch (err) {
      console.error('[Tool] HTML generation failed:', err.message);
      const errBlock = `[HTML GENERATION RESULT]\nFailed to generate HTML: ${err.message}\n[END HTML GENERATION RESULT]`;
      return { handled: true, generatedMedia: [], newMessages: [{ role: 'assistant', content: reply.replace(generateHTMLMatch[0], '').trim() || '[Generating HTML]' }, { role: 'user', content: errBlock }], embedTokens: 0 };
    }
  }

  // ── GENERATE_JSON handler ─────────────────────────────────
  const generateJSONMatch = findGenerateJSONMatch(reply);
  if (generateJSONMatch) {
    const jsonBody = generateJSONMatch[1].trim();
    onStatus?.({ type: 'status', tool: 'json_gen', message: 'Generating JSON file...' });
    console.log('[Tool] JSON generation requested');
    try {
      let parsed;
      try { parsed = JSON.parse(jsonBody); } catch { throw new Error('Invalid JSON structure.'); }
      const data = parsed.data || parsed;

      const jsonApproval = await requestToolApproval('GENERATE_JSON', {}, onStatus, abortController?.signal);
      if (!jsonApproval.approved) {
        return { handled: true, newMessages: [{ role: 'assistant', content: reply.replace(generateJSONMatch[0], '').trim() || '[JSON generation]' }, { role: 'user', content: `[JSON GENERATION RESULT]\nJSON generation was ${jsonApproval.reason || 'cancelled'}.\n[END JSON GENERATION RESULT]` }], embedTokens: 0 };
      }
      if (jsonApproval.instructions) return makeInstructionsResult(generateJSONMatch[0], reply, 'GENERATE_JSON', jsonApproval.instructions);

      const fileResult = await generateJSON(data, user?.id, topicId);
      const resultBlock = `[JSON GENERATION RESULT]\nJSON file successfully created.\nFile: ${fileResult.file_name}\nFile ID: ${fileResult.file_id}\n[END JSON GENERATION RESULT]\n\nTell the user the JSON file is ready to download.`;
      return { handled: true, generatedMedia: [{ file_id: fileResult.file_id, file_name: fileResult.file_name, file_type: 'json' }], newMessages: [{ role: 'assistant', content: reply.replace(generateJSONMatch[0], '').trim() || '[Generating JSON]' }, { role: 'user', content: resultBlock }], embedTokens: 0 };
    } catch (err) {
      console.error('[Tool] JSON generation failed:', err.message);
      const errBlock = `[JSON GENERATION RESULT]\nFailed to generate JSON: ${err.message}\n[END JSON GENERATION RESULT]`;
      return { handled: true, generatedMedia: [], newMessages: [{ role: 'assistant', content: reply.replace(generateJSONMatch[0], '').trim() || '[Generating JSON]' }, { role: 'user', content: errBlock }], embedTokens: 0 };
    }
  }

  // ── GENERATE_MD handler ───────────────────────────────────
  const generateMDMatch = findGenerateMDMatch(reply);
  if (generateMDMatch) {
    const jsonBody = generateMDMatch[1].trim();
    onStatus?.({ type: 'status', tool: 'md_gen', message: 'Generating Markdown file...' });
    console.log('[Tool] Markdown generation requested');
    try {
      let parsed;
      try { parsed = JSON.parse(jsonBody); } catch { throw new Error('Invalid Markdown JSON structure.'); }
      const content = parsed.content || '';
      const title = parsed.title || '';

      const mdApproval = await requestToolApproval('GENERATE_MD', { title }, onStatus, abortController?.signal);
      if (!mdApproval.approved) {
        return { handled: true, newMessages: [{ role: 'assistant', content: reply.replace(generateMDMatch[0], '').trim() || '[Markdown generation]' }, { role: 'user', content: `[MD GENERATION RESULT]\nMarkdown generation was ${mdApproval.reason || 'cancelled'}.\n[END MD GENERATION RESULT]` }], embedTokens: 0 };
      }
      if (mdApproval.instructions) return makeInstructionsResult(generateMDMatch[0], reply, 'GENERATE_MD', mdApproval.instructions);

      const fileResult = await generateMarkdown(content, title, user?.id, topicId);
      const resultBlock = `[MD GENERATION RESULT]\nMarkdown file successfully created.\nFile: ${fileResult.file_name}\nFile ID: ${fileResult.file_id}\n[END MD GENERATION RESULT]\n\nTell the user the Markdown file is ready to download.`;
      return { handled: true, generatedMedia: [{ file_id: fileResult.file_id, file_name: fileResult.file_name, file_type: 'md' }], newMessages: [{ role: 'assistant', content: reply.replace(generateMDMatch[0], '').trim() || '[Generating Markdown]' }, { role: 'user', content: resultBlock }], embedTokens: 0 };
    } catch (err) {
      console.error('[Tool] Markdown generation failed:', err.message);
      const errBlock = `[MD GENERATION RESULT]\nFailed to generate Markdown: ${err.message}\n[END MD GENERATION RESULT]`;
      return { handled: true, generatedMedia: [], newMessages: [{ role: 'assistant', content: reply.replace(generateMDMatch[0], '').trim() || '[Generating Markdown]' }, { role: 'user', content: errBlock }], embedTokens: 0 };
    }
  }

  return { handled: false };
};

module.exports = {
  buildFileContext,
  processToolCall,
  // Exported for testing
  findSearchFileMatch,
  findGetFileMatch,
  findWebSearchMatch,
  findGenerateImageMatch,
  findGeneratePPTMatch,
  findGeneratePDFMatch,
  findGenerateExcelMatch,
  findGenerateDocxMatch,
  findGenerateCSVMatch,
  findGenerateChartMatch,
  findGenerateHTMLMatch,
  findGenerateJSONMatch,
  findGenerateMDMatch,
};
