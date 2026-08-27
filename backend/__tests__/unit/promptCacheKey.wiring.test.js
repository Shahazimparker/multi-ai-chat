// FILE: backend/__tests__/unit/promptCacheKey.wiring.test.js
// PURPOSE: Guard the one field Mistral prompt caching depends on.
//
// Mistral caching is NOT automatic — without `prompt_cache_key` the API simply
// does not cache, and says nothing about it. Verified live 2026-08-28 on
// mistral-medium (the app's default model): 0 cached tokens without the key,
// 1152 with it. A regression here is therefore invisible in every log and every
// response; only the bill moves. Hence these tests.

const axios = require('axios');
const { callMistral } = require('../../services/ai/mistral.service');

describe('Mistral — prompt_cache_key', () => {
  beforeEach(() => vi.restoreAllMocks());

  const mistralResponse = {
    data: {
      choices: [{ message: { content: 'ok' } }],
      usage: { total_tokens: 100, prompt_tokens_details: { cached_tokens: 64 } },
    },
  };

  it('sends prompt_cache_key when one is supplied', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue(mistralResponse);

    await callMistral('mistral-medium', 'k', [{ role: 'user', content: 'hi' }], null, {
      promptCacheKey: 'multiaichat:topic:abc',
    });

    expect(post.mock.calls[0][1].prompt_cache_key).toBe('multiaichat:topic:abc');
  });

  it('omits the field entirely when there is no key, rather than sending null', async () => {
    // Mistral validates its request body strictly — it already rejects
    // stream_options outright — so an explicit null is a real risk, not a
    // hypothetical one.
    const post = vi.spyOn(axios, 'post').mockResolvedValue(mistralResponse);

    await callMistral('mistral-medium', 'k', [{ role: 'user', content: 'hi' }], null, {});

    expect(post.mock.calls[0][1]).not.toHaveProperty('prompt_cache_key');
  });

  it('reports cache reads from the non-streaming path', async () => {
    // This path returned { text, tokensUsed } only, so cacheReadTokens came back
    // undefined while the streaming path reported correctly.
    vi.spyOn(axios, 'post').mockResolvedValue(mistralResponse);

    const r = await callMistral('mistral-medium', 'k', [{ role: 'user', content: 'hi' }], null, {});

    expect(r.cacheReadTokens).toBe(64);
  });
});

describe('Groq — non-streaming cache reporting', () => {
  // groq-sdk cannot be reached with vi.mock (node_modules package, externalised
  // for CJS; deps.inline does not help either) and `chat` is an instance field
  // rather than a prototype method, so prototype spying fails too. Both attempts
  // fell through to a real, billed API call. The service therefore exposes a
  // setGroqClient seam, mirroring setBlobClient in blobStorage.service.js.
  const { callGroq, setGroqClient } = require('../../services/ai/groq.service');
  const create = vi.fn();

  beforeEach(() => {
    create.mockReset();
    setGroqClient(class {
      constructor() { this.chat = { completions: { create: (...a) => create(...a) } }; }
    });
  });
  afterEach(() => setGroqClient(null));

  it('reports cached_tokens from the non-streaming path', async () => {
    // Groq caches automatically (no key needed); this path simply was not
    // reading the field, so every hit reported as zero.
    create.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: { total_tokens: 200, prompt_tokens_details: { cached_tokens: 128 } },
    });

    const r = await callGroq('openai/gpt-oss-20b', 'k', [{ role: 'user', content: 'hi' }], null);

    expect(r.cacheReadTokens).toBe(128);
    expect(r.tokensUsed).toBe(200);
  });

  it('reports a clean zero when Groq sends no cache detail', async () => {
    create.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: { total_tokens: 200 },
    });

    const r = await callGroq('openai/gpt-oss-20b', 'k', [{ role: 'user', content: 'hi' }], null);

    expect(r.cacheReadTokens).toBe(0);
    expect(r.cacheHit).toBe(false);
  });
});
