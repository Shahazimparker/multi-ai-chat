// Real AI provider integration tests — requires .env with API keys
// Run: npx vitest run --config vitest.real.config.js
// WARNING: These tests consume API tokens and may incur costs!

const { dispatchToAI, dispatchToAIStream } = require('../../services/ai/dispatcher.service');
const { MODELS } = require('../../config/models');

const simpleMessages = [
  { role: 'user', content: 'Reply with exactly: OK' },
];

// Helper: test a model if its API key is configured
const testModelIfConfigured = (modelId, modelConfig) => {
  const label = modelConfig.label || modelId;

  if (!modelConfig.apiKey) {
    it.skip(`${label} — SKIPPED (no API key)`, () => {});
    return;
  }

  it(`${label} — responds to simple prompt`, async () => {
    const result = await dispatchToAI(modelConfig, simpleMessages);
    expect(result).toBeDefined();
    expect(result.text).toBeTruthy();
    expect(typeof result.text).toBe('string');
    expect(result.text.length).toBeGreaterThan(0);
    console.log(`[${label}] Response: ${result.text.slice(0, 100)}...`);
    console.log(`[${label}] Tokens used: ${result.tokensUsed}`);
  }, 30000);

  // ── REAL STREAMING TEST (no mocks, no artificial delays) ──
  it(`${label} — streams real tokens`, async () => {
    const chunks = [];
    const result = await dispatchToAIStream(
      modelConfig,
      simpleMessages,
      null,
      (chunk) => { chunks.push(chunk); }
    );

    expect(result).toBeDefined();
    expect(result.text).toBeTruthy();
    expect(typeof result.text).toBe('string');
    expect(result.text.length).toBeGreaterThan(0);

    // Should have received multiple chunks (unless response is tiny)
    expect(chunks.length).toBeGreaterThan(0);
    // Reconstructed text should match
    expect(chunks.join('')).toBe(result.text);

    console.log(`[${label} Stream] ${chunks.length} chunks, ${result.text.length} chars, tokens=${result.tokensUsed}`);
  }, 30000);
};

describe('AI Providers (real)', () => {
  // ── Gemini ──────────────────────────────────────────
  describe('Gemini', () => {
    testModelIfConfigured('gemini-flash', MODELS['gemini-flash']);
    testModelIfConfigured('gemini-pro', MODELS['gemini-pro']);
  });

  // ── Groq ────────────────────────────────────────────
  describe('Groq', () => {
    testModelIfConfigured('groq-mixtral', MODELS['groq-mixtral']);
    testModelIfConfigured('groq-llama', MODELS['groq-llama']);
  });

  // ── Mistral ─────────────────────────────────────────
  describe('Mistral', () => {
    testModelIfConfigured('mistral-small', MODELS['mistral-small']);
    testModelIfConfigured('mistral-medium', MODELS['mistral-medium']);
  });

  // ── DeepSeek ────────────────────────────────────────
  describe('DeepSeek', () => {
    testModelIfConfigured('deepseek-v4-flash', MODELS['deepseek-v4-flash']);
    testModelIfConfigured('deepseek-v4-pro', MODELS['deepseek-v4-pro']);
  });

  // ── OpenAI ──────────────────────────────────────────
  describe('OpenAI', () => {
    // OpenAI is called via the 'openai' provider in dispatcher
    // Check if we have a configured OpenAI model
    const openaiConfigured = !!process.env.OPENAI_API_KEY;
    if (openaiConfigured) {
      it('OpenAI — responds via dispatcher', async () => {
        const config = {
          provider: 'openai',
          model: 'gpt-4o-mini',
          apiKey: process.env.OPENAI_API_KEY,
          label: 'OpenAI GPT-4o-mini',
        };
        const result = await dispatchToAI(config, simpleMessages);
        expect(result.text).toBeTruthy();
        console.log(`[OpenAI] Tokens used: ${result.tokensUsed}`);
      }, 30000);
    } else {
      it.skip('OpenAI — SKIPPED (no API key)', () => {});
    }
  });

  // ── OpenRouter ──────────────────────────────────────
  describe('OpenRouter', () => {
    testModelIfConfigured('openrouter', {
      ...MODELS['openrouter'],
      model: 'openai/gpt-4o-mini', // Use a cheap model for testing
    });
  });
});
