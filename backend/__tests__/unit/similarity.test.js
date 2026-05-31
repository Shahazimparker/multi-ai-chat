// vitest globals: describe, it, expect

const { jaccardSimilarity } = require('../../services/similarity.service');

describe('jaccardSimilarity', () => {
  it('returns 1.0 for identical texts', () => {
    const result = jaccardSimilarity('database schema migration', 'database schema migration');
    expect(result).toBeCloseTo(1.0, 1);
  });

  it('returns 0 for completely different texts', () => {
    const result = jaccardSimilarity('database schema migration', 'hello world today');
    expect(result).toBe(0);
  });

  it('returns value between 0 and 1 for partial overlap', () => {
    const result = jaccardSimilarity('database schema migration strategy', 'database schema design pattern');
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  it('returns 0 when one input is empty', () => {
    expect(jaccardSimilarity('', 'hello world')).toBe(0);
    expect(jaccardSimilarity('hello world', '')).toBe(0);
  });

  it('filters out stop words', () => {
    const result = jaccardSimilarity('the database is the schema', 'a database and a schema');
    expect(result).toBeCloseTo(1.0, 1);
  });

  it('filters out words shorter than 3 chars', () => {
    const result = jaccardSimilarity('db schema', 'my schema');
    expect(result).toBeCloseTo(1.0, 1);
  });

  it('is case insensitive', () => {
    const result = jaccardSimilarity('Database Schema', 'database schema');
    expect(result).toBeCloseTo(1.0, 1);
  });

  it('ignores punctuation', () => {
    const result = jaccardSimilarity('database, schema! migration?', 'database schema migration');
    expect(result).toBeCloseTo(1.0, 1);
  });
});
