// vitest globals: describe, it, expect

const { stripToolTags, isPlaceholderOnly, classifyError } = require('../../services/chatCleanup.service');

describe('stripToolTags', () => {
  it('returns empty string for falsy input', () => {
    expect(stripToolTags(null)).toBe(null);
    expect(stripToolTags('')).toBe('');
    expect(stripToolTags(undefined)).toBe(undefined);
  });

  it('strips [QUERY_DB]...[/QUERY_DB] blocks', () => {
    const input = '[QUERY_DB]SELECT * FROM users[/QUERY_DB]\nHere are the results.';
    expect(stripToolTags(input)).toBe('Here are the results.');
  });

  it('strips [QUERY_DB]...<SQL_QUERY>... variant', () => {
    const input = '[QUERY_DB]<SQL_QUERY>SELECT 1</SQL_QUERY>[/QUERY_DB]\nAnswer.';
    expect(stripToolTags(input)).toBe('Answer.');
  });

  it('strips <QUERY_DB>...[/QUERY_DB] variant', () => {
    const input = '<QUERY_DB>SELECT * FROM orders</QUERY_DB>\nDone.';
    expect(stripToolTags(input)).toBe('Done.');
  });

  it('strips <query>...</query> variant', () => {
    const input = '<query>SELECT 1</query>\nResults here.';
    expect(stripToolTags(input)).toBe('Results here.');
  });

  it('strips <Function id="query_db_..."> variant', () => {
    const input = '<Function id="query_db_1">SELECT * FROM t</Function>\nOutput.';
    expect(stripToolTags(input)).toBe('Output.');
  });

  it('strips [GET_SCHEMA:...] tags', () => {
    const input = '[GET_SCHEMA:users,orders]\nSchema loaded.';
    expect(stripToolTags(input)).toBe('Schema loaded.');
  });

  it('strips <GET_SCHEMA:...> tags', () => {
    const input = '<GET_SCHEMA:invoices>\nHere.';
    expect(stripToolTags(input)).toBe('Here.');
  });

  it('strips <GET_SCHEMA>...</GET_SCHEMA> tags', () => {
    const input = '<GET_SCHEMA>products</GET_SCHEMA>\nDone.';
    expect(stripToolTags(input)).toBe('Done.');
  });

  it('strips <DB_SCHEMA_REQUEST>...</DB_SCHEMA_REQUEST>', () => {
    const input = '<DB_SCHEMA_REQUEST>users</DB_SCHEMA_REQUEST>\nOk.';
    expect(stripToolTags(input)).toBe('Ok.');
  });

  it('strips [DB_SCHEMA_REQUEST:...]', () => {
    const input = '[DB_SCHEMA_REQUEST:users]\nDone.';
    expect(stripToolTags(input)).toBe('Done.');
  });

  it('strips <request>...</request> blocks', () => {
    const input = '<request><method>Get_Schema</method></request>\nResult.';
    expect(stripToolTags(input)).toBe('Result.');
  });

  it('strips <request_label>...</request_label> blocks', () => {
    const input = '<request_label>Get Schema</request_label><request_text>users</request_text>\nOk.';
    expect(stripToolTags(input)).toBe('Ok.');
  });

  it('strips [SEARCH_FILES:query=...]', () => {
    const input = '[SEARCH_FILES:query=invoice report]\nFound.';
    expect(stripToolTags(input)).toBe('Found.');
  });

  it('strips [GET_FILE:id=...]', () => {
    const input = '[GET_FILE:id=abc123]\nContent.';
    expect(stripToolTags(input)).toBe('Content.');
  });

  it('strips [WEB_SEARCH:...]', () => {
    const input = '[WEB_SEARCH:query="latest news"]\nResults.';
    expect(stripToolTags(input)).toBe('Results.');
  });

  it('strips [EXECUTE_CODE]...[/EXECUTE_CODE]', () => {
    const input = '[EXECUTE_CODE]console.log(1)[/EXECUTE_CODE]\nOutput.';
    expect(stripToolTags(input)).toBe('Output.');
  });

  it('strips orphan closing tags', () => {
    expect(stripToolTags('[/QUERY_DB]\nHello')).toBe('Hello');
    expect(stripToolTags('</QUERY_DB>\nHello')).toBe('Hello');
    expect(stripToolTags('</query>\nHello')).toBe('Hello');
    expect(stripToolTags('</SQL_QUERY>\nHello')).toBe('Hello');
    expect(stripToolTags('</Function>\nHello')).toBe('Hello');
  });

  it('strips ```sql blocks when stripSqlBlocks is true', () => {
    const input = '```sql\nSELECT * FROM users\n```\n\nHere are the results.';
    expect(stripToolTags(input, { stripSqlBlocks: true })).toBe('Here are the results.');
  });

  it('strips <SQL_QUERY> blocks when stripSqlBlocks is true', () => {
    const input = '<SQL_QUERY>SELECT 1</SQL_QUERY>\nDone.';
    expect(stripToolTags(input, { stripSqlBlocks: true })).toBe('Done.');
  });

  it('strips placeholder status lines when stripSqlBlocks is true', () => {
    const input = '[Querying database...]\nActual answer.';
    expect(stripToolTags(input, { stripSqlBlocks: true })).toBe('Actual answer.');
  });

  it('collapses multiple newlines when stripSqlBlocks is true', () => {
    const input = 'Hello\n\n\n\nWorld';
    expect(stripToolTags(input, { stripSqlBlocks: true })).toBe('Hello\n\nWorld');
  });

  it('handles text with no tool tags unchanged', () => {
    const input = 'This is a normal response with no tool tags.';
    expect(stripToolTags(input)).toBe(input);
  });

  it('handles multiple tool blocks at the start', () => {
    const input = '[QUERY_DB]SELECT 1[/QUERY_DB]\n[GET_SCHEMA:users]\nFinal answer.';
    expect(stripToolTags(input)).toBe('Final answer.');
  });
});

describe('isPlaceholderOnly', () => {
  it('returns true for falsy input', () => {
    expect(isPlaceholderOnly(null)).toBe(true);
    expect(isPlaceholderOnly('')).toBe(true);
  });

  it('returns true for short placeholder strings', () => {
    expect(isPlaceholderOnly('[Querying database...]')).toBe(true);
    expect(isPlaceholderOnly('[Preparing query...]')).toBe(true);
    expect(isPlaceholderOnly('[Getting schema...]')).toBe(true);
    expect(isPlaceholderOnly('[Searching files...]')).toBe(true);
    expect(isPlaceholderOnly('[Requesting file...]')).toBe(true);
    expect(isPlaceholderOnly('[Attempting to query...]')).toBe(true);
  });

  it('returns false for normal responses', () => {
    expect(isPlaceholderOnly('Here are the results from the database.')).toBe(false);
    expect(isPlaceholderOnly('The query returned 5 rows.')).toBe(false);
  });

  it('returns false for long text even if it starts with placeholder', () => {
    const longText = '[Querying database...]' + 'x'.repeat(60);
    expect(isPlaceholderOnly(longText)).toBe(false);
  });
});

describe('classifyError', () => {
  it('classifies quota errors', () => {
    const result = classifyError('Insufficient quota for this request');
    expect(result.errorType).toBe('quota_exhausted');
  });

  it('classifies rate limit errors', () => {
    const result = classifyError('429 Too many requests');
    expect(result.errorType).toBe('rate_limited');
  });

  it('classifies model unavailable errors', () => {
    const result = classifyError('Model decommissioned');
    expect(result.errorType).toBe('model_unavailable');
  });

  it('classifies API key errors', () => {
    const result = classifyError('401 Unauthorized - invalid API key');
    expect(result.errorType).toBe('api_key_missing');
  });

  it('classifies connection errors', () => {
    const result = classifyError('ECONNREFUSED');
    expect(result.errorType).toBe('connection');
  });

  it('classifies DNS errors', () => {
    const result = classifyError('ENOTFOUND api.example.com');
    expect(result.errorType).toBe('server');
  });

  it('classifies timeout errors', () => {
    const result = classifyError('Request timeout after 30s');
    expect(result.errorType).toBe('timeout');
  });

  it('classifies 413 request too large errors', () => {
    const result = classifyError('413 Request too large');
    expect(result.errorType).toBe('request_too_large');
  });

  it('returns unknown for unrecognized errors', () => {
    const result = classifyError('Something completely unexpected happened');
    expect(result.errorType).toBe('unknown');
  });

  it('handles non-string input', () => {
    const result = classifyError(null);
    expect(result.errorType).toBe('unknown');
  });

  it('provides user-friendly messages for each type', () => {
    const types = ['quota_exhausted', 'rate_limited', 'model_unavailable', 'api_key_missing', 'connection', 'server', 'timeout', 'request_too_large'];
    for (const type of types) {
      const result = classifyError(type);
      expect(result.userMessage).toBeTruthy();
      expect(result.userMessage.length).toBeGreaterThan(10);
    }
  });
});
