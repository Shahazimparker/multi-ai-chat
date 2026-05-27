// vitest globals: describe, it, expect

const {
  estimateTokens,
  trimTextByTokens,
  estimateMessagesTokens,
  fitMessagesToBudget,
  createPromptBudget,
  calculateComplexityScore,
  createDynamicPromptBudget,
  parseMemoryBlock,
  rebuildMemoryBlock,
  smartTrimContextBlock,
} = require('../../services/tokenBudget.service');

describe('estimateTokens', () => {
  it('returns 0 for empty/falsy input', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });

  it('returns 0 for whitespace-only', () => {
    expect(estimateTokens('   ')).toBe(0);
  });

  it('estimates tokens for short text', () => {
    const result = estimateTokens('Hello world');
    expect(result).toBeGreaterThanOrEqual(2);
    expect(result).toBeLessThanOrEqual(4);
  });

  it('estimates tokens for longer text', () => {
    const text = 'The quick brown fox jumps over the lazy dog';
    const result = estimateTokens(text);
    expect(result).toBeGreaterThan(5);
  });

  it('handles non-string by converting', () => {
    expect(estimateTokens(123)).toBeGreaterThan(0);
  });
});

describe('trimTextByTokens', () => {
  it('returns empty string for falsy input', () => {
    expect(trimTextByTokens('', 100)).toBe('');
    expect(trimTextByTokens(null, 100)).toBe('');
  });

  it('returns empty string when maxTokens <= 0', () => {
    expect(trimTextByTokens('hello', 0)).toBe('');
    expect(trimTextByTokens('hello', -1)).toBe('');
  });

  it('returns full text when within budget', () => {
    expect(trimTextByTokens('hi', 100)).toBe('hi');
  });

  it('truncates text exceeding budget', () => {
    const longText = 'x'.repeat(500);
    const result = trimTextByTokens(longText, 10);
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result).toMatch(/\.\.\.$/);
  });
});

describe('estimateMessagesTokens', () => {
  it('returns 0 for empty array', () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });

  it('estimates tokens for message array', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    const result = estimateMessagesTokens(messages);
    expect(result).toBeGreaterThan(0);
  });

  it('adds 4 overhead tokens per message', () => {
    const messages = [{ role: 'user', content: 'a' }];
    const result = estimateMessagesTokens(messages);
    expect(result).toBeGreaterThanOrEqual(5);
  });
});

describe('fitMessagesToBudget', () => {
  it('returns all messages when within budget', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    const result = fitMessagesToBudget(messages, 1000);
    expect(result).toHaveLength(2);
  });

  it('trims last message when over budget', () => {
    const messages = [
      { role: 'user', content: 'x'.repeat(5000) },
    ];
    const result = fitMessagesToBudget(messages, 200);
    expect(result).toHaveLength(1);
    expect(result[0].content.length).toBeLessThan(5000);
  });

  it('drops messages that cannot fit minimum useful tokens', () => {
    const messages = [
      { role: 'user', content: 'x'.repeat(5000) },
    ];
    const result = fitMessagesToBudget(messages, 10);
    expect(result).toHaveLength(0);
  });
});

describe('createPromptBudget', () => {
  it('returns budget for default config', () => {
    const budget = createPromptBudget();
    expect(budget.maxPromptTokens).toBeGreaterThan(0);
    expect(budget.systemTokens).toBeGreaterThan(0);
    expect(budget.historyTokens).toBeGreaterThan(0);
    expect(budget.ragTokens).toBeGreaterThan(0);
    expect(budget.fileTokens).toBeGreaterThan(0);
    expect(budget.queryTokens).toBeGreaterThan(0);
    expect(budget.toolLoopTokens).toBeGreaterThan(0);
  });

  it('scales with model maxTokens', () => {
    const small = createPromptBudget({ maxTokens: 4096 });
    const large = createPromptBudget({ maxTokens: 128000 });
    expect(large.maxPromptTokens).toBeGreaterThan(small.maxPromptTokens);
  });

  it('respects minimum prompt budget', () => {
    const budget = createPromptBudget({ maxTokens: 1000 });
    expect(budget.maxPromptTokens).toBeGreaterThanOrEqual(1200);
  });
});

describe('calculateComplexityScore', () => {
  it('returns low score for simple text', () => {
    const score = calculateComplexityScore('hello how are you');
    // 5 words / 80 = 0.0625, rounded to 0.1
    expect(score).toBeLessThanOrEqual(0.5);
  });

  it('detects high-weight SAP keywords', () => {
    const score = calculateComplexityScore('How to configure SAP HANA with S4HANA and ABAP');
    expect(score).toBeGreaterThan(0);
  });

  it('detects mid-weight technical keywords', () => {
    const score = calculateComplexityScore('implement database api endpoint integration');
    expect(score).toBeGreaterThan(0);
  });

  it('detects SQL patterns', () => {
    const score = calculateComplexityScore('SELECT * FROM users WHERE id = 1');
    expect(score).toBeGreaterThanOrEqual(1);
  });

  it('detects code blocks', () => {
    const score = calculateComplexityScore('```\nconst x = 1;\n```');
    expect(score).toBeGreaterThanOrEqual(1.5);
  });

  it('detects JSON patterns', () => {
    const score = calculateComplexityScore('{"key": "value"}');
    expect(score).toBeGreaterThanOrEqual(0.5);
  });

  it('clamps to max 10', () => {
    const query = Array(20).fill('sap abap hana btp algorithm architecture').join(' ');
    const score = calculateComplexityScore(query);
    expect(score).toBeLessThanOrEqual(10);
  });

  it('factors in history text', () => {
    const scoreWithoutHistory = calculateComplexityScore('hello');
    const scoreWithHistory = calculateComplexityScore('hello', 'sap hana database migration architecture');
    expect(scoreWithHistory).toBeGreaterThanOrEqual(scoreWithoutHistory);
  });
});

describe('createDynamicPromptBudget', () => {
  it('returns lean budget for new topics', () => {
    const budget = createDynamicPromptBudget(0, 0);
    expect(budget.historyTokens).toBeLessThan(budget.maxPromptTokens * 0.3);
  });

  it('returns larger history budget for complex topics', () => {
    const budget = createDynamicPromptBudget(5, 8);
    expect(budget.historyTokens).toBeGreaterThan(budget.maxPromptTokens * 0.3);
  });

  it('returns larger history budget for long conversations', () => {
    const budget = createDynamicPromptBudget(20, 3);
    expect(budget.historyTokens).toBeGreaterThan(budget.maxPromptTokens * 0.3);
  });

  it('includes debug info', () => {
    const budget = createDynamicPromptBudget(10, 5);
    expect(budget._debug).toBeDefined();
    expect(budget._debug.turnCount).toBe(10);
    expect(budget._debug.complexityScore).toBe(5);
  });
});

describe('parseMemoryBlock and rebuildMemoryBlock', () => {
  it('parses structured memory block', () => {
    const block = '[OLDER CONVERSATION SUMMARY]\nSummary text here\n[END OLDER CONVERSATION SUMMARY]\n\n[LATEST RAW CONVERSATION]\nLatest messages\n[END LATEST RAW CONVERSATION]';
    const parsed = parseMemoryBlock(block);
    expect(parsed.hasSummary).toBe(true);
    expect(parsed.hasLatest).toBe(true);
    expect(parsed.summary).toBe('Summary text here');
    expect(parsed.latest).toBe('Latest messages');
  });

  it('handles missing sections', () => {
    const block = 'Just some text without markers';
    const parsed = parseMemoryBlock(block);
    expect(parsed.hasSummary).toBe(false);
    expect(parsed.hasLatest).toBe(false);
  });

  it('rebuilds memory block from parsed', () => {
    const original = '[OLDER CONVERSATION SUMMARY]\nTest\n[END OLDER CONVERSATION SUMMARY]\n\n[LATEST RAW CONVERSATION]\nData\n[END LATEST RAW CONVERSATION]';
    const parsed = parseMemoryBlock(original);
    const rebuilt = rebuildMemoryBlock(parsed);
    expect(rebuilt).toContain('[OLDER CONVERSATION SUMMARY]');
    expect(rebuilt).toContain('[LATEST RAW CONVERSATION]');
  });

  it('rebuilds with empty summary', () => {
    const rebuilt = rebuildMemoryBlock({
      hasSummary: false,
      hasLatest: true,
      summary: '',
      latest: 'Data',
      prefix: '',
    });
    expect(rebuilt).not.toContain('[OLDER CONVERSATION SUMMARY]');
    expect(rebuilt).toContain('[LATEST RAW CONVERSATION]');
  });
});

describe('smartTrimContextBlock', () => {
  it('returns block unchanged when within budget', () => {
    const block = 'Short text';
    const result = smartTrimContextBlock(block, 1000);
    expect(result).toBe(block);
  });

  it('trims unstructured text using fallback', () => {
    const longText = 'x'.repeat(5000);
    const result = smartTrimContextBlock(longText, 10);
    expect(result.length).toBeLessThan(5000);
  });

  it('trims summary when latest fits but summary does not', () => {
    const summary = 'x'.repeat(500);
    const latest = 'short';
    const block = `[OLDER CONVERSATION SUMMARY]\n${summary}\n[END OLDER CONVERSATION SUMMARY]\n\n[LATEST RAW CONVERSATION]\n${latest}\n[END LATEST RAW CONVERSATION]`;
    const result = smartTrimContextBlock(block, 50);
    expect(result).toContain('[LATEST RAW CONVERSATION]');
  });

  it('trims both when everything is huge', () => {
    const summary = 'x'.repeat(100);
    const latest = 'y'.repeat(2000);
    const block = `[OLDER CONVERSATION SUMMARY]\n${summary}\n[END OLDER CONVERSATION SUMMARY]\n\n[LATEST RAW CONVERSATION]\n${latest}\n[END LATEST RAW CONVERSATION]`;
    const result = smartTrimContextBlock(block, 100);
    // Strategy 4: trims both (80% latest, 20% summary)
    expect(result).toContain('[LATEST RAW CONVERSATION]');
    expect(result.length).toBeLessThan(block.length);
  });
});
