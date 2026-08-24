const stripToolTags = (text, opts = {}) => {
  if (!text) return text;
  const { stripSqlBlocks = false } = opts;

  const toolBlockPatterns = [
    /^\s*\[QUERY_DB\]\s*(?:<SQL_QUERY>\s*)?[\s\S]*?\s*(?:\[\/QUERY_DB\]|<\/SQL_QUERY>|<\/QUERY_DB>)/,
    /^\s*<QUERY_DB>\s*(?:<SQL_QUERY>\s*)?[\s\S]*?\s*(?:<\/SQL_QUERY>\s*)?[\s\S]*?\[\/QUERY_DB\]/,
    /^\s*<QUERY_DB>\s*(?:<SQL_QUERY>\s*)?[\s\S]*?\s*<\/QUERY_DB>/,
    /^\s*<query>\s*[\s\S]*?\s*<\/query>/i,
    /^\s*<Function\s+id="query_db_\d+"\s*>[\s\S]*?<\/Function>/i,
    /^\s*\[GET_SCHEMA:[^\]]+\]/,
    /^\s*<GET_SCHEMA:[^>]+>/,
    /^\s*<GET_SCHEMA>[^<]+<\/GET_SCHEMA>/,
    /^\s*<DB_SCHEMA_REQUEST>[\s\S]*?<\/DB_SCHEMA_REQUEST>/i,
    /^\s*\[DB_SCHEMA_REQUEST:?[^\]]+\]/i,
    /^\s*<request[^>]*>[\s\S]*?<\/request>/i,
    /^\s*<request_label>Get\s+Schema<\/request_label>\s*<request_text>[^<]+<\/request_text>/i,
    /^\s*\[SEARCH_FILES:query=[^\]]+\]/,
    /^\s*\[GET_FILE:id=[^\]]+\]/,
    /^\s*\[WEB_SEARCH:[^\]]+\]/i,
    /^\s*\[EXECUTE_CODE\][\s\S]*?\[\/EXECUTE_CODE\]/i,
  ];

  const orphanClosing = [
    /^\s*\[\/QUERY_DB\]/,
    /^\s*<\/QUERY_DB>/,
    /^\s*<\/query>/i,
    /^\s*<\/SQL_QUERY>/,
    /^\s*<\/Function>/i,
  ];

  let result = text;
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of toolBlockPatterns) {
      const match = result.match(pattern);
      if (match) {
        result = result.slice(match[0].length);
        changed = true;
        break;
      }
    }
  }

  for (const pattern of orphanClosing) {
    const match = result.match(pattern);
    if (match) result = result.slice(match[0].length);
  }

  if (stripSqlBlocks) {
    result = result.replace(/```sql[\s\S]*?```/gi, '').trim();
    result = result.replace(/<SQL_QUERY>[\s\S]*?<\/SQL_QUERY>/gi, '').trim();
    result = result.replace(/^\s*\[(?:Querying|Preparing|Getting|Searching|Requesting|Attempting)[^\]]*\]\s*$/gim, '').trim();
    result = result.replace(/\n{3,}/g, '\n\n');
  }

  return result.trim();
};

const isPlaceholderOnly = (text) => {
  if (!text) return true;
  const trimmed = text.trim();
  if (trimmed.length < 60 && /^\[(?:Querying|Preparing|Getting|Searching|Requesting|Attempting)[^\]]*\]$/i.test(trimmed)) {
    return true;
  }
  return false;
};

const classifyError = (messageText) => {
  const msg = String(messageText || '');
  let errorType = 'unknown';
  let userMessage = 'The selected LLM is temporarily unavailable.';

  if (/413|too large|request too large|context length|maximum context|context_length_exceeded|tokens/i.test(msg)) {
    errorType = 'request_too_large';
    userMessage = 'This request exceeds the model token context limit. Please select another model with a higher token limit or try again.';
  } else if (/quota|insufficient|credit|billing|exceeded/i.test(msg)) {
    errorType = 'quota_exhausted';
    userMessage = 'The selected LLM token quota is exhausted.';
  } else if (/rate limit|429|too many/i.test(msg)) {
    errorType = 'rate_limited';
    userMessage = 'The selected LLM is rate limited right now.';
  // Deliberately not a bare /model/: provider errors mention the word in almost
  // every failure mode, so matching it alone swallowed auth, connection and
  // timeout errors below and reported all of them as a dead model.
  } else if (/decommissioned|does not exist|unsupported|model[_ ]?not[_ ]?found|not_found_error|no such model|invalid model/i.test(msg)) {
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
  stripToolTags,
  isPlaceholderOnly,
  classifyError,
};
