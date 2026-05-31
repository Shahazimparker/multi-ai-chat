const { searchUserFilesRAG, getFileContent } = require('./fileUpload.service');
const { searchWeb } = require('./tools/webSearch.service');
const { executeCode } = require('./tools/codeExecute.service');
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
const findExecuteCodeMatch = (reply) => reply.match(/\[EXECUTE_CODE\]([\s\S]*?)\[\/EXECUTE_CODE\]/i);
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
const EXECUTE_CODE_ENABLED = String(process.env.ENABLE_EXECUTE_CODE || '').toLowerCase() === 'true';

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

  const executeCodeMatch = findExecuteCodeMatch(reply);
  if (executeCodeMatch) {
    if (!EXECUTE_CODE_ENABLED || !user?.id) {
      const disabledMessage = !EXECUTE_CODE_ENABLED
        ? 'Code execution is disabled by server policy.'
        : 'Code execution requires authenticated access.';
      return {
        handled: true,
        newMessages: [
          { role: 'assistant', content: reply.replace(executeCodeMatch[0], '').trim() || '[Code execution blocked]' },
          { role: 'user', content: `[CODE EXECUTION RESULT]\n${disabledMessage}\n[END CODE EXECUTION RESULT]` },
        ],
        embedTokens: 0,
      };
    }
    const code = executeCodeMatch[1].trim();
    const result = await executeCode(code);
    const resultBlock = `[CODE EXECUTION RESULT]\n\`\`\`\n${result}\n\`\`\`\n[END CODE EXECUTION RESULT]\n\nNow answer the user's question based on this result.`;

    return {
      handled: true,
      newMessages: [
        { role: 'assistant', content: reply.replace(executeCodeMatch[0], '').trim() || '[Executing JavaScript code]' },
        { role: 'user', content: resultBlock },
      ],
      embedTokens: 0,
    };
  }

  // ── GENERATE_IMAGE handler ────────────────────────────────
  const generateImageMatch = findGenerateImageMatch(reply);
  if (generateImageMatch) {
    const prompt = generateImageMatch[1].trim();
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
      return await runPPTGeneration({ parsed, reply, user, topicId, onStatus });
    } catch (err) {
      console.error('[Tool] PPT generation failed:', err.message);
      const errBlock = `[PPT GENERATION RESULT]\nFailed to generate presentation: Invalid function-call arguments for generate_ppt.\n[END PPT GENERATION RESULT]`;
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
    try {
      let parsed;
      try {
        parsed = JSON.parse(jsonBody);
      } catch {
        throw new Error('Invalid PPT JSON structure - could not parse slides.');
      }
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
  findExecuteCodeMatch,
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
