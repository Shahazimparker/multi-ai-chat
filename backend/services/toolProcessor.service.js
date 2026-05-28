const { searchUserFilesRAG, getFileContent } = require('./fileUpload.service');
const { searchWeb } = require('./tools/webSearch.service');
const { executeCode } = require('./tools/codeExecute.service');

const extractReferencedTables = (sql = '') => {
  const tables = new Set();
  const tableRegex = /\b(?:FROM|JOIN)\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
  let match;

  while ((match = tableRegex.exec(sql)) !== null) {
    tables.add(match[1]);
  }

  return [...tables];
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
const findExecuteCodeMatch = (reply) => reply.match(/\[EXECUTE_CODE\]([\s\S]*?)\[\/EXECUTE_CODE\]/i);

const findGetSchemaMatch = (reply) => {
  let m = reply.match(/\[GET_SCHEMA:([^\]]+)\]/);
  if (!m) m = reply.match(/<GET_SCHEMA:([^>]+)>/);
  if (!m) m = reply.match(/<GET_SCHEMA>([^<]+)<\/GET_SCHEMA>/);
  if (!m) m = reply.match(/<DB_SCHEMA_REQUEST>\s*([^<]+?)\s*<\/DB_SCHEMA_REQUEST>/i);
  if (!m) m = reply.match(/\[DB_SCHEMA_REQUEST:?\s*([^\]]+)\]/i);
  if (!m) m = reply.match(/<request>\s*<method>Get_Schema<\/method>\s*<params>\s*<table>([^<]+)<\/table>\s*<\/params>\s*<\/requests?>/i);
  if (!m) {
    const reqMatch = reply.match(/<request[^>]*>[\s\S]*?<\/request>/i);
    if (reqMatch) {
      const tablesJSON = reqMatch[0].match(/["']tables["']\s*:\s*\[([^\]]+)\]/i);
      if (tablesJSON) {
        const tables = tablesJSON[1].match(/["']([^"']+)["']/g);
        if (tables) {
          m = [reqMatch[0], tables.map(t => t.replace(/["']/g, '')).join(', ')];
        }
      }
    }
  }
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

const processToolCall = async ({
  reply,
  aiMessages,
  user,
  topicId,
  abortController,
  fetchedSchemaTables,
  consecutiveZeroResults = 0,
  dbQueryCount = 0,
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
      dbQueried: false,
      lastSqlQuery: '',
      consecutiveZeroResults,
      dbQueryCount,
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
        dbQueried: false,
        lastSqlQuery: '',
        consecutiveZeroResults,
        dbQueryCount,
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
      consecutiveZeroResults,
      dbQueryCount,
    };
  }

  const webSearchMatch = findWebSearchMatch(reply);
  if (webSearchMatch) {
    const query = webSearchMatch[1].trim();
    onStatus?.({
      type: 'status',
      tool: 'web_search',
      message: `Searching the web for "${query}"...`,
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
        { role: 'assistant', content: reply.replace(webSearchMatch[0], '').trim() || `[Searching web for "${query}"]` },
        { role: 'user', content: resultBlock },
      ],
      embedTokens: 0,
      dbQueried: false,
      lastSqlQuery: '',
      consecutiveZeroResults,
      dbQueryCount,
    };
  }

  const executeCodeMatch = findExecuteCodeMatch(reply);
  if (executeCodeMatch) {
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
      dbQueried: false,
      lastSqlQuery: '',
      consecutiveZeroResults,
      dbQueryCount,
    };
  }

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
      consecutiveZeroResults,
      dbQueryCount,
    };
  }

  return { handled: false };
};

module.exports = {
  extractReferencedTables,
  buildFileContext,
  formatDbResults,
  buildFallbackDbReply,
  processToolCall,
  // Exported for testing
  findSearchFileMatch,
  findGetFileMatch,
  findWebSearchMatch,
  findExecuteCodeMatch,
  findGetSchemaMatch,
  findQueryDbMatch,
  hasBareCloseTag,
};
