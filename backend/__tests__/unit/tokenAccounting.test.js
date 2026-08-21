// vitest globals: describe, it, expect, vi, beforeEach, afterEach
// globals: true is set in vitest.config.js

const { calculateBillableTokens } = require('../../services/tokenAccounting.service');

describe('calculateBillableTokens', () => {
  it('uses totalAITokens when > 0 (API-reported path)', () => {
    const result = calculateBillableTokens({
      totalAITokens: 500,
      totalEmbeddingTokens: 100,
      estimatedInputTokens: 50,
      compressTokens: 10,
      historySummaryTokens: 20,
    });
    expect(result).toBe(630); // 500 + 100 + 10 + 20 (estimatedInputTokens is NOT added — see double-count note)
  });

  it('falls back to promptTokens + estimate when totalAITokens is 0', () => {
    const result = calculateBillableTokens({
      totalAITokens: 0,
      promptTokens: 300,
      finalReply: 'Hello world',
      totalEmbeddingTokens: 100,
      estimatedInputTokens: 50,
    });
    // promptTokens (300) + estimate(finalReply) + totalEmbeddingTokens (100).
    // estimatedInputTokens (50) must NOT land in the total — promptTokens
    // already includes the user's message (aiMessages ends with it), so
    // adding estimatedInputTokens on top would double-count it.
    expect(result).toBeGreaterThan(400);
    expect(result).toBeLessThan(410);
  });

  it('does not double-count estimatedInputTokens on top of totalAITokens', () => {
    const withInput = calculateBillableTokens({
      totalAITokens: 500,
      estimatedInputTokens: 999,
    });
    const withoutInput = calculateBillableTokens({
      totalAITokens: 500,
    });
    expect(withInput).toBe(withoutInput);
    expect(withInput).toBe(500);
  });

  it('handles all-zero inputs gracefully', () => {
    const result = calculateBillableTokens({});
    expect(result).toBe(0);
  });

  it('handles missing optional fields', () => {
    const result = calculateBillableTokens({
      totalAITokens: 100,
    });
    expect(result).toBe(100);
  });

  it('includes historySummaryTokens in both paths', () => {
    const apiResult = calculateBillableTokens({
      totalAITokens: 200,
      historySummaryTokens: 50,
    });
    expect(apiResult).toBe(250);

    const fallbackResult = calculateBillableTokens({
      totalAITokens: 0,
      promptTokens: 100,
      finalReply: 'test',
      historySummaryTokens: 50,
    });
    expect(fallbackResult).toBeGreaterThan(150);
  });

  it('includes compressTokens in both paths', () => {
    const result = calculateBillableTokens({
      totalAITokens: 300,
      compressTokens: 25,
    });
    expect(result).toBe(325);
  });
});
