// vitest globals: describe, it, expect

const {
  buildFileContext,
} = require('../../services/toolProcessor.service');

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
