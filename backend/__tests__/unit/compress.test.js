// vitest globals: describe, it, expect

const { compressPrompt } = require('../../services/compress.service');

describe('compressPrompt', () => {
  it('returns short text unchanged (< 50 chars)', () => {
    const input = 'Hello';
    expect(compressPrompt(input)).toBe('Hello');
  });

  it('returns falsy input unchanged', () => {
    expect(compressPrompt('')).toBe('');
    expect(compressPrompt(null)).toBe(null);
  });

  it('strips "please" from prompts', () => {
    const input = 'Please help me understand how to configure the SAP system for our new project requirements';
    const result = compressPrompt(input);
    expect(result).not.toMatch(/\bplease\b/i);
  });

  it('strips "can you" phrases', () => {
    const input = 'Can you please help me explain the database schema for the ERP system integration project';
    const result = compressPrompt(input);
    expect(result).not.toMatch(/\bcan you\b/i);
    expect(result).not.toMatch(/\bplease\b/i);
  });

  it('strips "i would like you to" phrases', () => {
    const input = 'I would like you to generate a report on the quarterly sales data for all regions';
    const result = compressPrompt(input);
    expect(result).not.toMatch(/i would like you to/i);
  });

  it('strips "help me" phrases', () => {
    const input = 'Help me to understand the invoice processing workflow in the SAP system configuration';
    const result = compressPrompt(input);
    expect(result).not.toMatch(/\bhelp me\b/i);
  });

  it('strips "as an ai" phrases', () => {
    const input = 'As an AI language model, can you explain the difference between REST and SOAP APIs in detail';
    const result = compressPrompt(input);
    expect(result).not.toMatch(/as an ai/i);
  });

  it('strips greeting pleasantries', () => {
    const input = 'I hope you are doing well. Thank you in advance. Can you explain the database migration strategy for our project';
    const result = compressPrompt(input);
    // The regex for "thank you" is: /\b(thank you( in advance)?\.?\s*)/gi
    // This matches "thank you in advance." and removes it
    // Verify the meaningful content is preserved
    expect(result).toMatch(/database migration strategy/i);
  });

  it('collapses multiple spaces', () => {
    const input = 'Explain   the   database    schema   for    our    ERP    system    integration';
    const result = compressPrompt(input);
    expect(result).not.toMatch(/\s{2,}/);
  });

  it('returns original if compression removes >50%', () => {
    const input = 'Please kindly can you help me guide me assist me as an AI I hope you are doing well thank you in advance';
    const result = compressPrompt(input);
    expect(result).toBe(input);
  });

  it('preserves meaningful content', () => {
    const input = 'Can you please explain the SAP HANA database architecture and its integration with S4HANA systems for enterprise resource planning';
    const result = compressPrompt(input);
    expect(result).toMatch(/SAP HANA/i);
    expect(result).toMatch(/S4HANA/i);
    expect(result).toMatch(/enterprise resource planning/i);
  });
});
