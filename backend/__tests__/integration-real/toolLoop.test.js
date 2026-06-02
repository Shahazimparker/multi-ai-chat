// Real toolLoop integration tests — requires .env with API keys for at least one provider
// Run: npx vitest run --config vitest.real.config.js
// WARNING: These tests consume API tokens and may incur costs!

const { runToolLoop } = require('../../services/toolLoop.service');
const { MODELS } = require('../../config/models');

const HAS_DEEPSEEK = !!process.env.DEEPSEEK_API_KEY;
const HAS_GROQ     = !!process.env.GROQ_API_KEY;
const HAS_GEMINI   = !!process.env.GEMINI_API_KEY;
const describeReal = (HAS_DEEPSEEK || HAS_GROQ || HAS_GEMINI) ? describe : describe.skip;

// Prefer DeepSeek V4 Flash (paid, no free-tier quota cap) → Groq → Gemini Flash
const REAL_MODEL_ID = HAS_DEEPSEEK ? 'deepseek-v4-flash' : HAS_GROQ ? 'groq-llama' : 'gemini-flash';

describeReal('runToolLoop (real)', () => {
  const modelConfig = MODELS[REAL_MODEL_ID];
  const abortController = new AbortController();

  it('completes a single round with no tool calls', async () => {
    const aiMessages = [
      { role: 'system', content: 'You are a helpful assistant. Reply concisely.' },
      { role: 'user', content: 'Reply with exactly: HELLO' },
    ];

    const result = await runToolLoop({
      effectiveModelConfig: modelConfig,
      aiMessages,
      abortController,
      processToolCallArgs: {
        user: null,
        topicId: null,
        abortController,
        onStatus: null,
      },
      promptBudget: { maxPromptTokens: 32000 },
      maxToolRounds: 3,
      loggerPrefix: 'TestToolLoop',
    });

    expect(result.aborted).toBe(false);
    expect(result.finalReply).toBeTruthy();
    expect(result.finalReply.trim()).toBe('HELLO');
    expect(result.totalAITokens).toBeGreaterThan(0);
  }, 30000);

  it('throws AbortError when aborted during dispatch', async () => {
    const localAbort = new AbortController();
    const aiMessages = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Write a very long essay about AI safety.' },
    ];

    // Abort after a short delay — fires before the first token arrives
    setTimeout(() => localAbort.abort(), 100);

    await expect(runToolLoop({
      effectiveModelConfig: modelConfig,
      aiMessages,
      abortController: localAbort,
      processToolCallArgs: {
        user: null,
        topicId: null,
        abortController: localAbort,
        onStatus: null,
      },
      promptBudget: { maxPromptTokens: 32000 },
      maxToolRounds: 3,
      loggerPrefix: 'TestToolLoop',
    // Different SDKs surface abort differently: "aborted", "canceled", "Request was aborted."
    })).rejects.toThrow(/abort|cancel/i);
  }, 30000);
});
