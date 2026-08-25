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
// Late-bound: rag2 requires toolProcessor's siblings, and a namespace import
// also keeps this stubbable in tests.
const rag2Service = require('./rag2.service');

/**
 * Wait for approval with polling (non-blocking runtime compatibility)
 */
const POLL_INTERVAL_START_MS = 500;
const POLL_INTERVAL_MAX_MS = 3000;
const APPROVAL_TIMEOUT_MS = 120000; // 2 minutes

const waitForUserApproval = async (requestId, abortSignal) => {
  const handler = approvalManager.getHandler('default');
  const startTime = Date.now();
  let pollInterval = POLL_INTERVAL_START_MS;

  while (Date.now() - startTime < APPROVAL_TIMEOUT_MS) {
    if (abortSignal?.aborted) return { approved: false, reason: 'aborted' };

    try {
      // The response to this request is frequently written from a different
      // lambda instance than the one polling here, so every poll must hit the
      // store — a same-instance cache read would just replay whatever status
      // this instance saw first and never notice an approval granted elsewhere.
      const request = await handler.getRequestFresh(requestId);

      if (request?.status === 'approved') {
        const instructions = (request.reason && request.reason !== 'Approved from chat') ? request.reason : '';
        return { approved: true, reason: '', instructions };
      }
      if (request?.status === 'rejected') return { approved: false, reason: request.reason || 'Rejected by user' };
      if (request?.status === 'expired') return { approved: false, reason: 'Approval timed out' };
    } catch (err) {
      console.warn('[ToolProcessor] Approval poll error:', err.message);
    }

    await new Promise(r => setTimeout(r, pollInterval));
    // Back off since each poll is now a DB round-trip, not a Map lookup.
    pollInterval = Math.min(pollInterval * 2, POLL_INTERVAL_MAX_MS);
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

// `instructions` is free text the user typed into the approval "Other" box and
// it is interpolated between [USER MODIFICATION REQUEST] markers. Nothing stops
// a user typing the closing marker themselves and continuing as if their text
// were outside the frame, so neutralise any literal marker before it reaches
// the prompt. Cheap, and it keeps the frame the only thing that closes it.
const defangInstructionDelimiters = (text) =>
  String(text ?? '').replace(
    /\[\s*(?:\/|END\s+)?USER\s+MODIFICATION\s+REQUEST\s*\]/gi,
    '(user modification request)',
  );

const makeInstructionsResult = (matchStr, reply, toolName, instructions) => ({
  handled: true,
  newMessages: [
    { role: 'assistant', content: (matchStr ? reply.replace(matchStr, '').trim() : reply.trim()) || `[${toolName} generation paused for revision]` },
    { role: 'user', content: `[USER MODIFICATION REQUEST]\nUser approved but requested these changes before generating:\n"${defangInstructionDelimiters(instructions)}"\nPlease revise your plan to incorporate these changes and regenerate.\n[END USER MODIFICATION REQUEST]` },
  ],
  embedTokens: 0,
});

/**
 * Request human approval before executing a generation tool
 */
const requestToolApproval = async (toolName, context, onStatus, abortSignal = null, userId = null) => {
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
      userId,
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
    // A security gate must fail CLOSED: if the approval request itself couldn't
    // even be created (DB down, table missing), the tool must not run unsupervised.
    return { approved: false, reason: 'blocked — the approval system is unavailable, please try again' };
  }
};

const buildFileContext = (fileResults, totalFileCount, forceWebSearch = false) => {
  const fileCountNote = totalFileCount > fileResults.length
    ? `\n(Showing ${fileResults.length} of ${totalFileCount} total files — use SEARCH_FILES to find older ones)`
    : '';

  const webInstruction = forceWebSearch
    ? `\n3. WEB_SEARCH FOR LOG DIAGNOSTICS & ERROR CODES: If you find unfamiliar error codes, database signatures (e.g. SQL30012, ORA-00600, Sybase/ASE/Postgres/MySQL errors), or system anomalies in an uploaded log file, use [WEB_SEARCH:query="..."] to look up the official vendor root-cause and known bugs on the web. Then use [SEARCH_FILES:query="..."] to cross-reference and verify those parameters in the log for an accurate, up-to-date diagnostic report.`
    : '';

  return fileResults.length > 0
    ? `[AVAILABLE UPLOADED FILES]\n${fileResults
      .map(r => `- ${r.file_name} (id: ${r.file_id})`)
      .join('\n')}${fileCountNote}\n[END UPLOADED FILES]\n\n` +
    `You have access to tools for uploaded files and logs:\n` +
    `1. SEARCH_FILES — use to grep or search for specific errors, timestamps, processes, or keywords across the entire file. ` +
    `Respond with: [SEARCH_FILES:query=<search text>] and I will return the matching lines with surrounding context.\n` +
    `2. GET_FILE — use when you need the diagnostic digest or full content of a specific file. ` +
    `Respond with: [GET_FILE:id=<file_id>] or [GET_FILE:<file_name>] and I will inject the content.${webInstruction}`
    : '';
};

const findSearchFileMatch = (reply) => reply.match(/\[SEARCH_FILES:query=([^\]]+)\]/i);
const findSearchKBMatch = (reply) => reply.match(/\[SEARCH_KB:query=(?:"|')([^"']+)(?:"|')\]/i) || reply.match(/\[SEARCH_KB:query=([^\]]+)\]/i);
const findGetFileMatch = (reply) =>
  reply.match(/\[GET_FILE:id=([^\]]+)\]/i) ||
  reply.match(/\[GET_FILE:([^\]]+)\]/i) ||
  reply.match(/\[READ_FILE:id=([^\]]+)\]/i) ||
  reply.match(/\[READ_FILE:([^\]]+)\]/i);
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

/**
 * Specialized SAP ST22 Short Dump Sectional Extractor
 * Inspired by hanadumpviewer and ABAP diagnostic observability tools.
 * Captures all canonical error analysis sections, stack traces,
 * source code extracts, and system variables with 100% precision.
 */
const parseSAPShortDump = (rawText, fileName) => {
  if (!rawText) return null;
  const isST22 = /(?:Runtime Errors|Short text of error|What happened\?|Fehleranalyse|Error analysis|Information on where terminated|Source Code Extract|Quelltextauszug|Active Calls\/Events|Contents of system variables|ABAP Program:)/i.test(rawText);
  if (!isST22) return null;

  const lines = rawText.split('\n');

  // Extract key header metadata
  const runtimeErrorMatch = rawText.match(/Runtime Errors\s*[:\s]\s*([A-Z0-9_]+)/i);
  const exceptionMatch = rawText.match(/(?:Exception|ABAP Exception)\s*[:\s]\s*([A-Z0-9_]+)/i);
  const programMatch = rawText.match(/(?:ABAP Program|Program)\s*[:\s]\s*([A-Z0-9_\/=]+)/i);
  const dateMatch = rawText.match(/(?:Date and Time|Datum und Zeit)\s*[:\s]\s*([^\r\n]+)/i);
  const componentMatch = rawText.match(/(?:Application Component|Komponente)\s*[:\s]\s*([A-Z0-9\-]+)/i);
  const shortTextMatch = rawText.match(/(?:Short text of error|Kurzbeschreibung)\s*[:\s]\s*([^\r\n]+)/i);

  // Helper to extract a bounded section between headers
  const extractSection = (startRegex, endRegex, maxLines = 80) => {
    let startIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (startRegex.test(lines[i])) {
        startIdx = i;
        break;
      }
    }
    if (startIdx === -1) return '';
    const collected = [];
    for (let i = startIdx; i < lines.length; i++) {
      if (i > startIdx && endRegex.test(lines[i])) break;
      collected.push(lines[i]);
      if (collected.length >= maxLines) break;
    }
    return collected.join('\n').trim();
  };

  const SECTION_END_PATTERN = /^(?:-{3,}|\*{3,}|={3,}|What happened\?|Error analysis|How to correct the error|Information on where terminated|Source Code Extract|Active Calls\/Events|Contents of system variables|Chosen variables|Internal notes|System environment|Fehleranalyse|Was ist passiert\?)/i;

  const whatHappened = extractSection(/What happened\?|Was ist passiert\?/i, SECTION_END_PATTERN, 40);
  const errorAnalysis = extractSection(/Error analysis|Fehleranalyse/i, SECTION_END_PATTERN, 60);
  const whereTerminated = extractSection(/Information on where terminated|Where terminated/i, SECTION_END_PATTERN, 35);
  const codeExtract = extractSection(/Source Code Extract|Quelltextauszug/i, SECTION_END_PATTERN, 80);
  const callStack = extractSection(/Active Calls\/Events|Aufrufhierarchie/i, SECTION_END_PATTERN, 60);
  const systemVars = extractSection(/Contents of system variables|Systemvariablen/i, SECTION_END_PATTERN, 40);
  const howToCorrect = extractSection(/How to correct the error|Fehlerbehebung/i, SECTION_END_PATTERN, 40);

  // If at least a runtime error or 2 key sections were identified, format structured ST22 digest
  if (!runtimeErrorMatch && !whatHappened && !whereTerminated && !codeExtract) {
    return null;
  }

  let output = `[SAP ST22 SHORT DUMP DIAGNOSTIC DIGEST: ${fileName || 'Dump'}]\n`;
  if (runtimeErrorMatch) output += `• Runtime Error: ${runtimeErrorMatch[1]}\n`;
  if (exceptionMatch) output += `• Exception: ${exceptionMatch[1]}\n`;
  if (shortTextMatch) output += `• Short Text: ${shortTextMatch[1].trim()}\n`;
  if (programMatch) output += `• Terminating Program: ${programMatch[1]}\n`;
  if (componentMatch) output += `• Application Component: ${componentMatch[1]}\n`;
  if (dateMatch) output += `• Timestamp: ${dateMatch[1].trim()}\n`;
  output += `\n`;

  if (whereTerminated) output += `--- WHERE TERMINATED (Program / Include / Line) ---\n${whereTerminated}\n\n`;
  if (codeExtract) output += `--- SOURCE CODE EXTRACT (Failing code line marked with >>>) ---\n${codeExtract}\n\n`;
  if (whatHappened) output += `--- WHAT HAPPENED ---\n${whatHappened}\n\n`;
  if (errorAnalysis) output += `--- ERROR ANALYSIS ---\n${errorAnalysis}\n\n`;
  if (callStack) output += `--- ACTIVE CALL STACK ---\n${callStack}\n\n`;
  if (systemVars) output += `--- SYSTEM VARIABLES (SY-*) ---\n${systemVars}\n\n`;
  if (howToCorrect) output += `--- HOW TO CORRECT THE ERROR ---\n${howToCorrect}\n\n`;
  output += `[END SAP ST22 SHORT DUMP DIGEST]`;

  return output;
};

/**
 * Automatically extract critical incident anomalies, errors, fatal crashes,
 * and high-entropy log events across massive files (10MB-50MB / 30,000+ lines).
 * Inspired by Logdy, OpenObserve, and Hanadumpviewer.
 */
const extractDiagnosticDigest = (rawText, fileName) => {
  if (!rawText) return '[No content available]';
  const lines = rawText.split('\n');
  const totalLines = lines.length;
  if (rawText.length <= 250000 && totalLines <= 1200) {
    return rawText;
  }

  // 1. Check for dedicated SAP ST22 Short Dump format
  const sapDigest = parseSAPShortDump(rawText, fileName);
  if (sapDigest) {
    return sapDigest;
  }

  // 2. First 120 lines (Boot / Startup / Initialization context)
  const headLines = lines.slice(0, 120).join('\n');

  // 3. High-Severity Anomaly & Incident Pattern Scanner across Linux, DBs & Apps
  const CRITICAL_PATTERNS = [
    // Process Kill / Termination / Panics / OOM
    /\b(out of memory|oom[-_]?killer|killed\s+process|killing\s+process|sigkill|sigterm|sigsegv|sigbus|core dumped|segmentation fault|segfault|kernel panic|panic|stack overflow)\b/i,
    // Severity keywords, Exceptions & Database Deadlocks
    /\b(fatal|critical|emergency|severe|exception|unhandled|traceback|deadlock|lock wait timeout|corruption|corrupted|abort|aborted|assertion failed)\b/i,
    // System Resource & Hardware / I/O Failures
    /\b(cannot allocate memory|resource temporarily unavailable|disk full|no space left on device|read-only file system|i\/o error|device error|hardware error|bus error)\b/i,
    // Network, Connection & Service Failures
    /\b(connection refused|connection reset|timed out|timeout|max connections reached|too many open files|broken pipe|network unreachable)\b/i,
    // Crash, Termination & Service Down Lifecycles
    /\b(crashed|crash|crashing|failed to start|stopped unexpectedly|terminated unexpectedly|shutting down unexpectedly|service down|server terminated|down|offline)\b/i,
    // Explicit Error & Failure Markers
    /\b(error:?|err:?|failure:?|failed:?)\b/i,
    // SAP ABAP / ST22 Short Dumps & Runtime Errors
    /\b(runtime error|short dump|rabax|rabax_state|message_type_x|tsv_tnew_page_alloc_failed|cx_sy_[a-z0-9_]+|cx_root|termination occurred in the abap program|abap program|call stack|error analysis|how to correct the error)\b/i,
    // SAP SM21 System Log, Work Process, RFC & Gateway Errors
    /\b(sm21|transaction cancelled|work process (?:killed|terminated|halted)|disp\+work|enqueue error|rfc_error_[a-z0-9_]+|system_failure|communication_failure|gateway error|abap dump)\b/i,
    // SAP BTP, Cloud Foundry, XSUAA & HANA Cloud Errors
    /\b(xsuaa|cf-appstopped|destination service|cloud connector|hana cloud|hdb_error|hdb sql error|sqlstate|db error|oauth token failed)\b/i,
  ];

  const matchedLineIndices = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (CRITICAL_PATTERNS.some(pat => pat.test(line))) {
      matchedLineIndices.push(i);
    }
  }

  // Group nearby line matches into incident clusters (with 3 lines before and 3 lines after)
  const clusters = [];
  const visited = new Set();

  for (const idx of matchedLineIndices) {
    if (visited.has(idx)) continue;
    const start = Math.max(0, idx - 3);
    const end = Math.min(lines.length - 1, idx + 4);
    for (let j = start; j <= end; j++) visited.add(j);

    const clusterSnippet = lines.slice(start, end + 1).map((l, offset) => {
      const lineNo = start + offset + 1;
      return `${lineNo}: ${l}`;
    }).join('\n');

    clusters.push({
      line: idx + 1,
      snippet: clusterSnippet,
    });

    if (clusters.length >= 35) break; // Keep top 35 high-signal incident clusters
  }

  // 4. Last 150 lines (Shutdown / Crash termination state)
  const tailLines = lines.slice(-150).map((l, offset) => `${totalLines - 150 + offset + 1}: ${l}`).join('\n');

  let incidentBlock = '';
  if (clusters.length > 0) {
    incidentBlock = `--- CRITICAL ERROR & ANOMALY INCIDENTS DETECTED ACROSS ALL ${totalLines} LINES (${clusters.length} clusters found) ---\n` +
      clusters.map((c, i) => `[Incident Cluster #${i + 1} around Line ${c.line}]\n${c.snippet}`).join('\n\n') + '\n\n';
  } else {
    incidentBlock = `--- NO FATAL ANOMALIES AUTOMATICALLY DETECTED IN MIDDLE SECTION ---\n\n`;
  }

  return `[DIAGNOSTIC LOG SUMMARY: ${fileName} (${totalLines} total lines, ${(rawText.length / (1024 * 1024)).toFixed(1)}MB)]
--- FILE START (Lines 1 to 120) ---
${headLines}

${incidentBlock}--- FILE END (Lines ${Math.max(1, totalLines - 150)} to ${totalLines}) ---
${tailLines}`;
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
  collectionIds = [],
  embedProvider = 'openrouter',
  ragTokenBudget = 2500,
  onCitations = null,
}) => {
  const searchMatch = findSearchFileMatch(reply);
  if (searchMatch) {
    const query = searchMatch[1].trim();
    const searchResult = await searchUserFilesRAG(query, user?.id, topicId, abortController.signal);
    const searchResults = searchResult.results || [];
    const embedTokens = searchResult.embedTokens || 0;

    const resultBlock = searchResults.length > 0
      ? `[SEARCH RESULTS for "${query}"]\n${searchResults
        .map(r => `- ${r.file_name} (id: ${r.file_id}):\n${r.chunk_text.slice(0, 1200)}`)
        .join('\n\n')}\n[END SEARCH RESULTS]`
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
    const fileTarget = getFileMatch[1].trim().replace(/^['"]|['"]$/g, '');
    const fileData = await getFileContent(fileTarget, user?.id, topicId);

    if (!fileData) {
      return {
        handled: true,
        newMessages: [
          { role: 'assistant', content: reply },
          { role: 'user', content: `[Tool Result] File "${fileTarget}" not found or access denied.` },
        ],
        embedTokens: 0,
      };
    }

    const rawContent = fileData.original_content || fileData.llm_analysis || '[No content available]';
    const fileContentToSend = extractDiagnosticDigest(rawContent, fileData.file_name);

    const contentBlock = `[FILE CONTENT: ${fileData.file_name}]\n\`\`\`\n${fileContentToSend}\n\`\`\`\n[END FILE CONTENT]\n\nNow answer the user's question based on this file content and diagnostic summary. Be concise, precise, and accurate.`;

    return {
      handled: true,
      newMessages: [
        { role: 'assistant', content: reply.replace(getFileMatch[0], '').trim() || `[Requesting file: ${fileData.file_name}]` },
        { role: 'user', content: contentBlock },
      ],
      embedTokens: 0,
    };
  }

  // ── SEARCH_KB handler ─────────────────────────────────────
  //
  // Retrieval as a TOOL rather than a fixed pre-step. The pipeline still runs
  // one automatic knowledge-base search before generation, but that search only
  // ever sees the user's original wording. This lets the model come back with a
  // better query once it knows what it is actually looking for — the difference
  // between one-shot retrieval and agentic retrieval.
  const searchKBMatch = findSearchKBMatch(reply);
  if (searchKBMatch) {
    const query = searchKBMatch[1].trim();
    const strippedReply = reply.replace(searchKBMatch[0], '').trim() || '[searching knowledge base]';

    if (!collectionIds || collectionIds.length === 0) {
      return {
        handled: true,
        newMessages: [
          { role: 'assistant', content: strippedReply },
          { role: 'user', content: `[KNOWLEDGE BASE RESULT]
No knowledge base is attached to this conversation, so there is nothing to search. Answer from the conversation and your own knowledge instead, and do not call SEARCH_KB again.
[END KNOWLEDGE BASE RESULT]` },
        ],
        embedTokens: 0,
      };
    }

    onStatus?.({
      type: 'status',
      tool: 'knowledge_search',
      message: `searching knowledge base: ${query.slice(0, 60)}`,
    });
    console.log(`[Tool] Knowledge base search requested: "${query.slice(0, 80)}"`);

    try {
      const kbResult = await rag2Service.searchKnowledgeCollections({
        query,
        collectionIds,
        userId: user?.id,
        tokenBudget: ragTokenBudget,
        embedProvider,
        signal: abortController?.signal,
      });

      const citations = kbResult.citations || [];
      if (citations.length > 0) {
        onStatus?.({ type: 'citations', citations });
        onCitations?.(citations);
      }

      // A zero-result search is a real answer, not a failure. Saying so plainly
      // stops the model from calling the tool again with the same query.
      const resultBlock = kbResult.chunkCount > 0
        ? `[KNOWLEDGE BASE RESULT for "${query}"]
${kbResult.context}
[END KNOWLEDGE BASE RESULT]

Now answer the user's question using these sources.`
        : `[KNOWLEDGE BASE RESULT for "${query}"]
No passage in the attached knowledge base matched this query well enough to cite. Either rephrase with different terms, or tell the user the knowledge base does not cover it — do not repeat this exact query.
[END KNOWLEDGE BASE RESULT]`;

      console.log(`[Tool] Knowledge base search returned ${kbResult.chunkCount} chunk(s)`);

      return {
        handled: true,
        newMessages: [
          { role: 'assistant', content: strippedReply },
          { role: 'user', content: resultBlock },
        ],
        embedTokens: kbResult.tokensUsed || 0,
      };
    } catch (err) {
      if (err?.name === 'AbortError' || err?.name === 'CanceledError') throw err;
      console.warn('[Tool] Knowledge base search failed:', err.message);
      return {
        handled: true,
        newMessages: [
          { role: 'assistant', content: strippedReply },
          { role: 'user', content: `[KNOWLEDGE BASE RESULT]
The knowledge base search failed. Answer from the context you already have and tell the user the knowledge base was unreachable.
[END KNOWLEDGE BASE RESULT]` },
        ],
        embedTokens: 0,
      };
    }
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
    const approval = await requestToolApproval('GENERATE_IMAGE', { prompt }, onStatus, abortController?.signal, user?.id);
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
      const pptApproval = await requestToolApproval('GENERATE_PPT', { title: parsed?.title, theme: parsed?.theme || parsed?.style, slides: parsed?.slides }, onStatus, abortController?.signal, user?.id);
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
    const approval = await requestToolApproval('GENERATE_PPT', { title: parsed?.title, theme: parsed?.theme || parsed?.style, slides: parsed?.slides }, onStatus, abortController?.signal, user?.id);
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

      const pdfApproval = await requestToolApproval('GENERATE_PDF', { title, sections }, onStatus, abortController?.signal, user?.id);
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

      const excelApproval = await requestToolApproval('GENERATE_EXCEL', { title, sheets }, onStatus, abortController?.signal, user?.id);
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

      const docxApproval = await requestToolApproval('GENERATE_DOCX', { title, sections }, onStatus, abortController?.signal, user?.id);
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

      const csvApproval = await requestToolApproval('GENERATE_CSV', { headers, rowCount: rows.length }, onStatus, abortController?.signal, user?.id);
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

      const chartApproval = await requestToolApproval('GENERATE_CHART', { type, title, labels }, onStatus, abortController?.signal, user?.id);
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

      const htmlApproval = await requestToolApproval('GENERATE_HTML', { title }, onStatus, abortController?.signal, user?.id);
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

      const jsonApproval = await requestToolApproval('GENERATE_JSON', {}, onStatus, abortController?.signal, user?.id);
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

      const mdApproval = await requestToolApproval('GENERATE_MD', { title }, onStatus, abortController?.signal, user?.id);
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
  findSearchKBMatch,
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
