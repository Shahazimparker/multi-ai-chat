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

// NOTE: Groq's non-streaming path got the same one-line fix (spreading
// extractCacheUsage over response.usage), but is not covered here. groq.service.js
// does `const Groq = require('groq-sdk')` and `chat` is an instance field, so the
// SDK resists both prototype spying and vi.mock under CJS require — the attempts
// fell through to a real, billed API call. The field parsing itself is locked by
// the `reads OpenAI prompt_tokens_details.cached_tokens` case in
// promptCache.test.js, which is the part that could actually regress.
