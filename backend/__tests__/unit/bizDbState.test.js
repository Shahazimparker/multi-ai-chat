// vitest globals: describe, it, expect

const { reserveToolLoopBudget, buildBizDbDirective } = require('../../services/bizDbState.service');

describe('reserveToolLoopBudget', () => {
  it('reserves tool loop tokens from budget', () => {
    const budget = {
      maxPromptTokens: 10000,
      systemTokens: 2000,
      historyTokens: 3000,
      ragTokens: 2500,
      fileTokens: 1500,
      queryTokens: 1000,
    };
    const result = reserveToolLoopBudget(budget);
    expect(result.toolReserveTokens).toBeGreaterThan(0);
    expect(result.contextBudgetTokens).toBeLessThan(budget.maxPromptTokens);
  });

  it('clamps tool reserve between 300 and 1400', () => {
    const tinyBudget = {
      maxPromptTokens: 1000,
      systemTokens: 200,
      historyTokens: 300,
      ragTokens: 250,
      fileTokens: 150,
      queryTokens: 100,
    };
    const result = reserveToolLoopBudget(tinyBudget);
    expect(result.toolReserveTokens).toBeGreaterThanOrEqual(300);
    expect(result.toolReserveTokens).toBeLessThanOrEqual(1400);
  });

  it('scales all budget categories down proportionally', () => {
    const budget = {
      maxPromptTokens: 10000,
      systemTokens: 2000,
      historyTokens: 3000,
      ragTokens: 2500,
      fileTokens: 1500,
      queryTokens: 1000,
    };
    const result = reserveToolLoopBudget(budget);
    expect(result.systemTokens).toBeLessThanOrEqual(budget.systemTokens);
    expect(result.historyTokens).toBeLessThanOrEqual(budget.historyTokens);
    expect(result.ragTokens).toBeLessThanOrEqual(budget.ragTokens);
    expect(result.fileTokens).toBeLessThanOrEqual(budget.fileTokens);
    expect(result.queryTokens).toBeLessThanOrEqual(budget.queryTokens);
  });

  it('respects minimum floor values', () => {
    const budget = {
      maxPromptTokens: 1000,
      systemTokens: 50,
      historyTokens: 50,
      ragTokens: 50,
      fileTokens: 50,
      queryTokens: 50,
    };
    const result = reserveToolLoopBudget(budget);
    expect(result.systemTokens).toBeGreaterThanOrEqual(100);
    expect(result.historyTokens).toBeGreaterThanOrEqual(200);
    expect(result.ragTokens).toBeGreaterThanOrEqual(200);
    expect(result.fileTokens).toBeGreaterThanOrEqual(150);
    expect(result.queryTokens).toBeGreaterThanOrEqual(120);
  });

  it('uses custom reserve ratio', () => {
    const budget = {
      maxPromptTokens: 10000,
      systemTokens: 2000,
      historyTokens: 3000,
      ragTokens: 2500,
      fileTokens: 1500,
      queryTokens: 1000,
    };
    const defaultResult = reserveToolLoopBudget(budget);
    const customResult = reserveToolLoopBudget(budget, 0.3);
    // Both hit the 1400 cap since 10000 * 0.15 = 1500 (capped at 1400)
    // and 10000 * 0.3 = 3000 (capped at 1400)
    expect(customResult.toolReserveTokens).toBeGreaterThanOrEqual(defaultResult.toolReserveTokens);
  });
});

describe('buildBizDbDirective', () => {
  it('returns empty directive when bizDb not connected', () => {
    const result = buildBizDbDirective(false);
    expect(result.bizDbDirective).toBe('');
  });

  it('returns dbOnly rules when effectiveDbOnly is true', () => {
    const result = buildBizDbDirective(true);
    expect(result).toHaveProperty('selectedSchema');
    expect(result).toHaveProperty('bizDbDirective');
  });

  it('returns relaxed rules when effectiveDbOnly is false', () => {
    const result = buildBizDbDirective(false);
    expect(result).toHaveProperty('selectedSchema');
    expect(result).toHaveProperty('bizDbDirective');
  });
});
