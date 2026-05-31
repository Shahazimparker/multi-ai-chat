// vitest globals: describe, it, expect

const { rerankMemoryRowsHybrid } = require('../../services/memory.service');

describe('rerankMemoryRowsHybrid', () => {
  it('returns empty array for empty input', () => {
    expect(rerankMemoryRowsHybrid([], 'test', 5, 0.5)).toEqual([]);
    expect(rerankMemoryRowsHybrid(null, 'test', 5, 0.5)).toEqual([]);
  });

  it('returns empty array when no rows pass threshold', () => {
    const rows = [
      { role: 'user', content: 'unrelated chat about weather', similarity: 0.1 },
      { role: 'assistant', content: 'here is the weather forecast', similarity: 0.15 },
    ];
    const result = rerankMemoryRowsHybrid(rows, 'database schema migration', 5, 0.5);
    expect(result).toEqual([]);
  });

  it('returns rows that pass hybrid threshold', () => {
    const rows = [
      { role: 'user', content: 'how to migrate database schema for ERP', similarity: 0.85 },
      { role: 'assistant', content: 'database schema migration involves careful planning', similarity: 0.8 },
    ];
    const result = rerankMemoryRowsHybrid(rows, 'database schema migration', 5, 0.5);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].hybridScore).toBeDefined();
    expect(result[0].accepted).toBe(true);
  });

  it('rejects rows with numeric critical miss when cosine is low enough', () => {
    // Query has "1234", doc only has "123" — cosine 0.7 → normalized 0.85 < 0.95 → critical miss
    const rows = [
      { role: 'user', content: 'what is the status of order 123', similarity: 0.7 },
    ];
    const result = rerankMemoryRowsHybrid(rows, 'order 1234 tracking', 5, 0.5);
    expect(result).toEqual([]);
  });

  it('accepts rows when all query numbers match', () => {
    const rows = [
      { role: 'user', content: 'order 1234 and invoice 5678 need review', similarity: 0.85 },
    ];
    const result = rerankMemoryRowsHybrid(rows, 'check order 1234 invoice 5678', 5, 0.5);
    expect(result.length).toBe(1);
    expect(result[0].accepted).toBe(true);
  });

  it('rejects rows with no lexical overlap and low cosine', () => {
    const rows = [
      { role: 'user', content: 'abc xyz def ghi jkl mno', similarity: 0.5 },
    ];
    const result = rerankMemoryRowsHybrid(rows, 'database schema migration strategy', 5, 0.5);
    expect(result).toEqual([]);
  });

  it('correctly rejects pure semantic match without lexical overlap', () => {
    // Even with cosine 0.99, hybrid score (0.55*0.995=0.547) < threshold 0.7
    // This is correct — pure semantic without lexical overlap should not pass alone
    const rows = [
      { role: 'user', content: 'abc xyz def ghi jkl mno', similarity: 0.99 },
    ];
    const result = rerankMemoryRowsHybrid(rows, 'database schema migration strategy', 5, 0.5);
    expect(result).toEqual([]);
  });

  it('sorts by hybridScore descending', () => {
    const rows = [
      { role: 'user', content: 'database indexing tips', similarity: 0.7 },
      { role: 'assistant', content: 'database schema migration for ERP systems requires planning', similarity: 0.9 },
      { role: 'user', content: 'database optimization techniques', similarity: 0.75 },
    ];
    const result = rerankMemoryRowsHybrid(rows, 'database schema migration', 5, 0.5);
    expect(result[0].content).toContain('ERP');
  });

  it('respects topK limit', () => {
    const rows = [
      { role: 'user', content: 'database schema migration strategy for large systems', similarity: 0.9 },
      { role: 'assistant', content: 'database schema design patterns and migration guide', similarity: 0.88 },
      { role: 'user', content: 'database optimization and schema migration tips', similarity: 0.85 },
      { role: 'assistant', content: 'database indexing and schema best practices', similarity: 0.82 },
      { role: 'user', content: 'database query performance tuning', similarity: 0.78 },
    ];
    const result = rerankMemoryRowsHybrid(rows, 'database schema migration', 3, 0.5);
    expect(result.length).toBe(3);
  });

  it('preserves role and content in results', () => {
    const rows = [
      { role: 'user', content: 'how to migrate database', similarity: 0.85 },
    ];
    const result = rerankMemoryRowsHybrid(rows, 'database migration', 5, 0.5);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toBe('how to migrate database');
  });

  it('gives numeric boost when all numbers match', () => {
    const rows = [
      { role: 'user', content: 'part number 98765 is out of stock', similarity: 0.7 },
    ];
    const result = rerankMemoryRowsHybrid(rows, 'part 98765 availability', 5, 0.5);
    expect(result.length).toBe(1);
    expect(result[0].hybridScore).toBeGreaterThan(0);
  });
});
