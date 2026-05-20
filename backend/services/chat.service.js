// ============================================================
// FILE: backend/services/chat.service.js
// PURPOSE: Shared chat utilities — extracted from
//   chat.controller.js and chat.routes.js to eliminate
//   code duplication (logic drift).
// ============================================================

const { buildRAGContext, embedText } = require('./rag.service');
const { searchUserFilesRAG, getFileContent, listUserFiles } = require('./fileUpload.service');
const { queryBusinessDB, getTableSchema } = require('./businessDb.service');

// ── Shared module-level Business DB state ──────────────────
let bizDbConnected = null;
let bizDbSchemaText = '';
let bizDbMinimalSchemaText = '';

const { initBusinessDB } = require('./businessDb.service');

/**
 * Initialize business DB connection (idempotent).
 * Called once on module load; re-call to force refresh.
 */
const ensureBizDbInit = async () => {
  if (bizDbConnected === null) {
    const state = await initBusinessDB();
    bizDbConnected = state.connected;
    bizDbSchemaText = state.schemaText;
    bizDbMinimalSchemaText = state.minimalSchemaText;
  }
  return { bizDbConnected, bizDbSchemaText, bizDbMinimalSchemaText };
};

// Init on module load
ensureBizDbInit();

// ── Tool loop budget ──────────────────────────────────────
const reserveToolLoopBudget = (promptBudget, reserveRatio = 0.15) => {
  const toolReserveTokens = Math.min(1400, Math.max(300, Math.floor(promptBudget.maxPromptTokens * reserveRatio)));
  const availableContextTokens = Math.max(900, promptBudget.maxPromptTokens - toolReserveTokens);
  const scale = Math.min(1, availableContextTokens / promptBudget.maxPromptTokens);

  return {
    ...promptBudget,
    toolReserveTokens,
    contextBudgetTokens: availableContextTokens,
    systemTokens: Math.max(100, Math.floor(promptBudget.systemTokens * scale)),
    historyTokens: Math.max(200, Math.floor(promptBudget.historyTokens * scale)),
    ragTokens: Math.max(200, Math.floor(promptBudget.ragTokens * scale)),
    fileTokens: Math.max(150, Math.floor(promptBudget.fileTokens * scale)),
    queryTokens: Math.max(120, Math.floor(promptBudget.queryTokens * scale)),
  };
};

// ── SQL table extraction ──────────────────────────────────
const extractReferencedTables = (sql = '') => {
  const tables = new Set();
  const tableRegex = /\b(?:FROM|JOIN)\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
  let match;

  while ((match = tableRegex.exec(sql)) !== null) {
    tables.add(match[1]);
  }

  return [...tables];
};

// ── System prompt builders ────────────────────────────────
const buildBizDbDirective = (effectiveDbOnly) => {
  const selectedSchema = effectiveDbOnly ? bizDbMinimalSchemaText : '';
  if (!bizDbConnected || !selectedSchema) return { selectedSchema, bizDbDirective: '' };

  const baseBizRules = `\n\n## Business Database Access\nYou have read-only access to a business database via [QUERY_DB] tool.\n\n${selectedSchema}`;

  const dbOnlyRules = baseBizRules + `\n\n🔒 ONLY DB MODE (ACTIVE):\n- EXAMINE the user's query carefully. If it asks about business data (sales, customers, orders, inventory, employees, reports, counts, financials, etc.) — use [QUERY_DB] to get LIVE data.\n- If it's a general question, greeting, small talk, or simply NOT about business data — answer normally from your knowledge without querying the DB.\n- You CANNOT use your training data for business facts, numbers, or answers. Always query the DB for those.\n- There is NO RAG/cache. Every business query is live.\n- If [QUERY_DB] returns empty — say "No data found in database."\n- NEVER fabricate or guess data. Only present what the DB returns.\n- NEVER call external APIs for business data.\n- NEVER show the SQL query text to the user — only present the formatted results.\n- Always run the query with concise and proper syntax — never show placeholder or sample data before querying.\n- Format results as tables for structured data.`;
  const relaxedBizRules = baseBizRules + `\n\n📋 RULES:\n- When the user asks about business data — query the DB using [QUERY_DB].\n- You may use your training knowledge alongside DB results.\n- If [QUERY_DB] returns empty, say "No data found in database."\n- NEVER fabricate data that should come from the DB.\n- NEVER call external APIs for business data.\n- Format results as tables for structured data.`;

  return {
    selectedSchema,
    bizDbDirective: effectiveDbOnly ? dbOnlyRules : relaxedBizRules,
  };
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

// ── Tool-call detection helpers ───────────────────────────
const findSearchFileMatch = (reply) => reply.match(/\[SEARCH_FILES:query=([^\]]+)\]/);
const findGetFileMatch = (reply) => reply.match(/\[GET_FILE:id=([^\]]+)\]/);

const findGetSchemaMatch = (reply) => {
  let m = reply.match(/\[GET_SCHEMA:([^\]]+)\]/);
  if (!m) m = reply.match(/<GET_SCHEMA:([^>]+)>/);  // Match <GET_SCHEMA:table1, table2>
  if (!m) m = reply.match(/<GET_SCHEMA>([^<]+)<\/GET_SCHEMA>/);
  if (!m) m = reply.match(/<request_label>Get\s+Schema<\/request_label>\s*<request_text>([^<]+)<\/request_text>/i);
  return m;
};

const findQueryDbMatch = (reply) => {
  let m = reply.match(/\[QUERY_DB\]\s*(?:<SQL_QUERY>\s*)?([\s\S]*?)\s*(?:\[\/QUERY_DB\]|<\/SQL_QUERY>|<\/QUERY_DB>)/);
  if (!m) m = reply.match(/<QUERY_DB>\s*<SQL_QUERY>\s*([\s\S]*?)\s*<\/SQL_QUERY>\s*\[\/QUERY_DB\]/);
  if (!m) m = reply.match(/<QUERY_DB>\s*([\s\S]*?)\s*<\/QUERY_DB>/);
  if (!m) m = reply.match(/<query>\s*([\s\S]*?)\s*<\/query>/i);
  if (!m) m = reply.match(/<Function\s+id="query_db_\d+"\s*>([\s\S]*?)<\/Function>/i);
  return m;
};

const hasBareCloseTag = (reply) => {
  return (
    (/\[\/QUERY_DB\]/.test(reply) && !/\[QUERY_DB\]/.test(reply)) ||
    (/<\/query>/i.test(reply) && !/<query>/i.test(reply)) ||
    (/<\/Function>/i.test(reply) && !/<Function\s+id="query_db_\d+"\s*>/i.test(reply))
  );
};

// ── DB result formatting ──────────────────────────────────
const formatDbResults = (dbResults) => {
  const resultCount = Array.isArray(dbResults) ? dbResults.length : 0;

  if (resultCount === 0) {
    return {
      resultBlock: `[QUERY DB RESULTS]\nNo results found for the query.\n[END RESULTS]\n\nThe data might not exist in the database. Ask the user to clarify or check if they meant something else.`,
      resultCount,
    };
  }

  const preview = JSON.stringify(dbResults.slice(0, 20), null, 2);
  const truncated = resultCount > 20 ? `\n(Showing 20 of ${resultCount} results)` : '';
  return {
    resultBlock: `[QUERY DB RESULTS - ${resultCount} rows]${truncated}\n\`\`\`json\n${preview}\n\`\`\`\n[END RESULTS]\n\nBased on these results, answer the user's question. Use tables for structured data.`,
    resultCount,
  };
};

const buildFallbackDbReply = (lastDbResultBlock) => {
  return `📊 **Database Results:**\n\n${lastDbResultBlock
    .replace(/\[QUERY DB RESULTS[^\]]*\]/g, '')
    .replace(/\[END RESULTS\][\s\S]*$/, '')
    .replace(/```json\n?/g, '```')
    .trim()}\n\n*AI ran out of tool rounds. Raw results shown above.*`;
};

// ── Tool-call processor ───────────────────────────────────
// Processes ONE round of tool calls from AI reply.
// Returns: { handled: boolean, newMessages: array, dbQueried: boolean, lastSqlQuery: string, consecutiveZeroResults: number }
// If handled is false, no tool call was detected (AI gave final answer).
const processToolCall = async ({
  reply,
  aiMessages,
  user,
  topicId,
  effectiveDbOnly,
  abortController,
  fetchedSchemaTables,
  consecutiveZeroResults = 0,
}) => {
  // ── SEARCH_FILES tool ──
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
      dbQueried: false,
      lastSqlQuery: '',
      consecutiveZeroResults: 0,
    };
  }

  // ── GET_FILE tool ──
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
        dbQueried: false,
        lastSqlQuery: '',
        consecutiveZeroResults: 0,
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
      dbQueried: false,
      lastSqlQuery: '',
      consecutiveZeroResults: 0,
    };
  }

  // ── GET_SCHEMA tool ──
  const getSchemaMatch = findGetSchemaMatch(reply);
  if (getSchemaMatch && bizDbConnected) {
    const tableNames = getSchemaMatch[1].split(',').map(s => s.trim());
    const schemaText = await getTableSchema(tableNames);
    tableNames.forEach((name) => fetchedSchemaTables.add(name));

    return {
      handled: true,
      newMessages: [
        {
          role: 'assistant',
          content: reply.replace(getSchemaMatch[0], '').trim() || `[Getting schema for ${tableNames.join(', ')}...]`,
        },
        {
          role: 'user',
          content: schemaText + '\n\nNow write your SQL query wrapped in [QUERY_DB] tags like this:\n[QUERY_DB]SELECT column1, column2 FROM table WHERE condition[/QUERY_DB]\nUse the exact column names from the schema above. Do NOT write anything else — just the [QUERY_DB] tags with SQL inside.',
        },
      ],
      embedTokens: 0,
      dbQueried: false,
      lastSqlQuery: '',
      consecutiveZeroResults: 0,
    };
  }

  // ── Bare closing tag (AI forgot opening tag) ──
  if (hasBareCloseTag(reply)) {
    return {
      handled: true,
      newMessages: [
        { role: 'assistant', content: reply },
        {
          role: 'user',
          content: `[SYSTEM] You used a closing tag ([/QUERY_DB], </query>, or </Function>) without providing any SQL query. Always wrap your SQL inside matching tags like this:\n\n[QUERY_DB]SELECT column1, column2 FROM table_name WHERE condition[/QUERY_DB]\n\nWrite the SQL query now inside [QUERY_DB] and [/QUERY_DB] tags. Do not use closing tags alone.`,
        },
      ],
      embedTokens: 0,
      dbQueried: false,
      lastSqlQuery: '',
      consecutiveZeroResults: 0,
    };
  }

  // ── QUERY_DB tool ──
  const queryDbMatch = findQueryDbMatch(reply);
  if (queryDbMatch && bizDbConnected) {
    const sql = queryDbMatch[1].trim();

    if (effectiveDbOnly) {
      const referencedTables = extractReferencedTables(sql);
      const missingSchemaTables = referencedTables.filter((table) => !fetchedSchemaTables.has(table));

      if (missingSchemaTables.length > 0) {
        return {
          handled: true,
          newMessages: [
            {
              role: 'assistant',
              content: reply.replace(queryDbMatch[0], '').trim() || `[Preparing database query...]`,
            },
            {
              role: 'user',
              content: `[SYSTEM] In DB-only mode, you must fetch column schema before querying. You tried to query these tables without GET_SCHEMA: ${missingSchemaTables.join(', ')}.\n\nCall GET_SCHEMA first for all referenced tables, then regenerate the SQL using the exact returned column names.\n\nRequired next step:\n[GET_SCHEMA:${missingSchemaTables.join(', ')}]`,
            },
          ],
          embedTokens: 0,
          dbQueried: false,
          lastSqlQuery: sql,
          consecutiveZeroResults: 0,
        };
      }
    }

    try {
      const dbResults = await queryBusinessDB(sql);
      const { resultBlock, resultCount } = formatDbResults(dbResults);
      const newConsecutiveZero = resultCount === 0 ? consecutiveZeroResults + 1 : 0;

      return {
        handled: true,
        newMessages: [
          {
            role: 'assistant',
            content: reply.replace(queryDbMatch[0], '').trim() || (resultCount === 0 ? 'No rows returned for this query.' : ''),
          },
          { role: 'user', content: resultBlock },
        ],
        embedTokens: 0,
        dbQueried: true,
        lastSqlQuery: sql,
        lastDbResultBlock: resultBlock,
        consecutiveZeroResults: newConsecutiveZero,
        resultCount,
      };
    } catch (dbErr) {
      const referencedTables = extractReferencedTables(sql);
      const schemaRecoveryHint = effectiveDbOnly && referencedTables.length > 0
        ? await getTableSchema(referencedTables)
        : '';

      return {
        handled: true,
        newMessages: [
          {
            role: 'assistant',
            content: reply.replace(queryDbMatch[0], '').trim() || `[Attempting to query database...]`,
          },
          {
            role: 'user',
            content: `[QUERY DB ERROR]\n${dbErr.message}\n[END ERROR]\n\n${schemaRecoveryHint ? `${schemaRecoveryHint}\n\n` : ''}Please fix your SQL query and try again. Make sure table and column names are correct.${schemaRecoveryHint ? ' Use the schema above and regenerate the SQL with exact column names.' : ' Use GET_SCHEMA for the referenced tables if you need to check the schema.'}`,
          },
        ],
        embedTokens: 0,
        dbQueried: true,
        lastSqlQuery: sql,
        consecutiveZeroResults: 0,
      };
    }
  }

  // No tool call detected
  return { handled: false };
};

// ── Final reply cleanup ───────────────────────────────────
const stripToolTags = (text, opts = {}) => {
  if (!text) return text;
  const { stripSqlBlocks = false } = opts;

  let result = text
    .replace(/\[QUERY_DB\]\s*(?:<SQL_QUERY>\s*)?[\s\S]*?\s*(?:\[\/QUERY_DB\]|<\/SQL_QUERY>|<\/QUERY_DB>)/g, '')
    .replace(/<QUERY_DB>\s*(?:<SQL_QUERY>\s*)?[\s\S]*?\s*(?:<\/SQL_QUERY>\s*)?[\s\S]*?\[\/QUERY_DB\]/g, '')
    .replace(/<QUERY_DB>\s*(?:<SQL_QUERY>\s*)?[\s\S]*?\s*<\/QUERY_DB>/g, '')
    .replace(/<query>\s*[\s\S]*?\s*<\/query>/gi, '')
    .replace(/<Function\s+id="query_db_\d+"\s*>[\s\S]*?<\/Function>/gi, '')
    .replace(/\[\/QUERY_DB\]/g, '')
    .replace(/<\/query>/gi, '')
    .replace(/\[GET_SCHEMA:[^\]]+\]/g, '')
    .replace(/<GET_SCHEMA:[^>]+>/g, '')  // Strip <GET_SCHEMA:table1, table2>
    .replace(/<GET_SCHEMA>[^<]+<\/GET_SCHEMA>/g, '')
    .replace(/<request_label>Get\s+Schema<\/request_label>\s*<request_text>[^<]+<\/request_text>/gi, '');

  if (stripSqlBlocks) {
    result = result.replace(/```sql[\s\S]*?```/g, '');
  }

  return result.trim();
};

// ── Error classification ──────────────────────────────────
const classifyError = (messageText) => {
  const msg = String(messageText || '');
  let errorType = 'unknown';
  let userMessage = 'The selected LLM is temporarily unavailable.';

  if (/413|too large|request too large/i.test(msg)) {
    errorType = 'request_too_large';
    userMessage = 'This model does not support such a large request. Please select another model with a higher token limit and try again.';
  } else if (/quota|insufficient|credit|billing|exceeded/i.test(msg)) {
    errorType = 'quota_exhausted';
    userMessage = 'The selected LLM token quota is exhausted.';
  } else if (/rate limit|429|too many/i.test(msg)) {
    errorType = 'rate_limited';
    userMessage = 'The selected LLM is rate limited right now.';
  } else if (/decommissioned|not found|unsupported|model/i.test(msg)) {
    errorType = 'model_unavailable';
    userMessage = 'The selected LLM model is unavailable or no longer supported.';
  } else if (/api key|authentication|unauthorized|401/i.test(msg)) {
    errorType = 'api_key_missing';
    userMessage = 'The selected LLM is not configured correctly.';
  } else if (/ECONNREFUSED|Connection/i.test(msg)) {
    errorType = 'connection';
    userMessage = 'Connection failed. Please check your internet.';
  } else if (/ENOTFOUND|DNS/i.test(msg)) {
    errorType = 'server';
    userMessage = 'Backend server not responding. Please try again.';
  } else if (/timeout/i.test(msg)) {
    errorType = 'timeout';
    userMessage = 'Request timeout. Please try again.';
  }

  return { errorType, userMessage };
};

module.exports = {
  // State
  ensureBizDbInit,
  get bizDbConnected() { return bizDbConnected; },
  get bizDbSchemaText() { return bizDbSchemaText; },
  get bizDbMinimalSchemaText() { return bizDbMinimalSchemaText; },

  // Pure utilities
  reserveToolLoopBudget,
  extractReferencedTables,

  // Builders
  buildBizDbDirective,
  buildFileContext,

  // Tool processing
  processToolCall,

  // Cleanup & formatting
  stripToolTags,
  formatDbResults,
  buildFallbackDbReply,

  // Error handling
  classifyError,
};
