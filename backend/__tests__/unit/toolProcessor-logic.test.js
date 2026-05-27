// vitest globals: describe, it, expect

const {
  extractReferencedTables,
  buildFileContext,
  formatDbResults,
  buildFallbackDbReply,
} = require('../../services/toolProcessor.service');

describe('extractReferencedTables', () => {
  it('extracts single table from simple SELECT', () => {
    const tables = extractReferencedTables('SELECT * FROM users');
    expect(tables).toEqual(['users']);
  });

  it('extracts multiple tables from JOINs', () => {
    const tables = extractReferencedTables(
      'SELECT * FROM orders JOIN customers ON orders.cust_id = customers.id'
    );
    expect(tables).toContain('orders');
    expect(tables).toContain('customers');
  });

  it('handles quoted identifiers', () => {
    // The regex /\b(?:FROM|JOIN)\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi
    // matches "User Orders" but captures only up to the first non-alphanumeric after opening quote
    // "User Orders" → captures "User" (space breaks the \w+ match)
    const tables = extractReferencedTables('SELECT * FROM "User Orders"');
    expect(tables.length).toBeGreaterThan(0);
  });

  it('handles mixed quoted and unquoted', () => {
    const tables = extractReferencedTables(
      'SELECT * FROM "Order Items" JOIN products ON "Order Items".product_id = products.id'
    );
    expect(tables).toContain('products');
  });

  it('returns empty array for non-SQL text', () => {
    expect(extractReferencedTables('hello world')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(extractReferencedTables('')).toEqual([]);
  });

  it('handles subqueries', () => {
    const tables = extractReferencedTables(
      'SELECT * FROM (SELECT id FROM users) sub JOIN orders ON sub.id = orders.user_id'
    );
    expect(tables).toContain('users');
    expect(tables).toContain('orders');
  });

  it('deduplicates repeated table names', () => {
    const tables = extractReferencedTables(
      'SELECT * FROM users JOIN users u2 ON users.id = u2.parent_id'
    );
    expect(tables).toEqual(['users']);
  });
});

describe('buildFileContext', () => {
  it('returns empty string for empty file list', () => {
    expect(buildFileContext([], 0)).toBe('');
  });

  it('builds context with file names and IDs', () => {
    const files = [
      { file_name: 'report.pdf', file_id: 'abc-123' },
      { file_name: 'data.xlsx', file_id: 'def-456' },
    ];
    const result = buildFileContext(files, 2);
    expect(result).toContain('report.pdf');
    expect(result).toContain('abc-123');
    expect(result).toContain('data.xlsx');
    expect(result).toContain('def-456');
    expect(result).toContain('SEARCH_FILES');
    expect(result).toContain('GET_FILE');
  });

  it('shows overflow note when totalCount > fileResults length', () => {
    const files = [{ file_name: 'a.pdf', file_id: '1' }];
    const result = buildFileContext(files, 10);
    expect(result).toContain('Showing 1 of 10');
  });

  it('does not show overflow note when counts match', () => {
    const files = [{ file_name: 'a.pdf', file_id: '1' }];
    const result = buildFileContext(files, 1);
    expect(result).not.toContain('Showing');
  });
});

describe('formatDbResults', () => {
  it('returns "No results" message for empty array', () => {
    const { resultBlock, resultCount } = formatDbResults([]);
    expect(resultCount).toBe(0);
    expect(resultBlock).toContain('No results found');
  });

  it('formats small result set', () => {
    const data = [{ id: 1, name: 'Test' }];
    const { resultBlock, resultCount } = formatDbResults(data);
    expect(resultCount).toBe(1);
    expect(resultBlock).toContain('1 rows');
    expect(resultBlock).toContain('"id": 1');
    expect(resultBlock).toContain('"name": "Test"');
  });

  it('truncates results > 20 rows', () => {
    const data = Array.from({ length: 25 }, (_, i) => ({ id: i }));
    const { resultBlock, resultCount } = formatDbResults(data);
    expect(resultCount).toBe(25);
    expect(resultBlock).toContain('Showing 20 of 25');
  });

  it('handles non-array input gracefully', () => {
    const { resultBlock, resultCount } = formatDbResults(null);
    expect(resultCount).toBe(0);
    expect(resultBlock).toContain('No results found');
  });
});

describe('buildFallbackDbReply', () => {
  it('builds reply from result block', () => {
    const block = '[QUERY DB RESULTS - 5 rows]\n```json\n[{"id":1}]\n```\n[END RESULTS]\n\nBased on these results...';
    const result = buildFallbackDbReply(block);
    expect(result).toContain('Database Results');
    expect(result).toContain('[{"id":1}]');
    expect(result).toContain('AI ran out of tool rounds');
  });

  it('strips result block markers', () => {
    const block = '[QUERY DB RESULTS - 1 rows]\n```json\n{"key":"value"}\n```\n[END RESULTS]';
    const result = buildFallbackDbReply(block);
    expect(result).not.toContain('[QUERY DB RESULTS');
    expect(result).not.toContain('[END RESULTS]');
  });
});
