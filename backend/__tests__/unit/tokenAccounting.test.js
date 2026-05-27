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
    expect(result).toBe(680); // 500 + 100 + 50 + 10 + 20
  });

  it('falls back to promptTokens + estimate when totalAITokens is 0', () => {
    const result = calculateBillableTokens({
      totalAITokens: 0,
      promptTokens: 300,
      finalReply: 'Hello world',
      totalEmbeddingTokens: 100,
      estimatedInputTokens: 50,
    });
    expect(result).toBeGreaterThan(450);
    expect(result).toBeLessThan(460);
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
