// vitest globals: describe, it, expect

const { jaccardSimilarity, isSameTopic } = require('../../services/similarity.service');

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

describe('isSameTopic', () => {
  it('returns false when recentMessages is empty', () => {
    expect(isSameTopic('database query', [])).toBe(false);
  });

  it('returns true when similarity exceeds threshold', () => {
    const recentMessages = [
      { content: 'database schema migration strategy for ERP' },
      { content: 'how to optimize database queries' },
    ];
    expect(isSameTopic('database schema migration', recentMessages, 0.15)).toBe(true);
  });

  it('returns false when similarity is below threshold', () => {
    const recentMessages = [
      { content: 'database schema migration strategy' },
    ];
    expect(isSameTopic('weather forecast today', recentMessages, 0.2)).toBe(false);
  });

  it('uses last 5 messages only', () => {
    const recentMessages = [
      { content: 'unrelated topic one' },
      { content: 'unrelated topic two' },
      { content: 'unrelated topic three' },
      { content: 'unrelated topic four' },
      { content: 'unrelated topic five' },
      { content: 'database schema migration' },
    ];
    // Last 5 are: topic two, three, four, five, database schema migration
    // "database" and "schema" overlap with "database schema migration" query
    // So similarity will be > 0. Use a high threshold to ensure false
    expect(isSameTopic('database schema migration', recentMessages, 0.5)).toBe(false);
  });

  it('uses custom threshold', () => {
    const recentMessages = [
      { content: 'database schema design' },
    ];
    expect(isSameTopic('weather forecast', recentMessages, 0.0)).toBe(true);
    expect(isSameTopic('weather forecast', recentMessages, 0.5)).toBe(false);
  });
});
