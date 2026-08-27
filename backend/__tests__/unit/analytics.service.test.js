// FILE: backend/__tests__/unit/analytics.service.test.js
// PURPOSE: Keep the two caches distinct in analytics, and keep a row landing
//          even when the prompt-cache migration has not been applied yet.

const supabase = require('../../config/supabase');
const { logAnalytics } = require('../../services/analytics.service');

const makeInsert = (impl) => {
  const insert = vi.fn(impl);
  vi.spyOn(supabase, 'from').mockReturnValue({ insert });
  return insert;
};

describe('logAnalytics — the two caches stay separate', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('records a response-cache hit as cache_hit with no prompt-cache tokens', () => {
    const insert = makeInsert(() => Promise.resolve({ error: null }));

    return logAnalytics({
      userId: 'u1', query: 'hi', modelId: 'deepseek-v4-flash',
      tokensUsed: 0, isAnonymous: false,
      cacheHit: true, promptCacheReadTokens: 0, promptCacheWriteTokens: 0,
      responseTimeMs: 5,
    }).then(() => {
      const row = insert.mock.calls[0][0];
      expect(row.cache_hit).toBe(true);
      expect(row.prompt_cache_read_tokens).toBe(0);
    });
  });

  it('records prompt-cache volume WITHOUT marking the reply as cached', async () => {
    // The regression this guards: once the adapters began reporting prompt-cache
    // reads, feeding cache_hit from them would have marked nearly every DeepSeek
    // reply "(Cached)" in the UI and pinned the admin hit-rate tile near 100%.
    const insert = makeInsert(() => Promise.resolve({ error: null }));

    await logAnalytics({
      userId: 'u1', query: 'hi', modelId: 'deepseek-v4-flash',
      tokensUsed: 900, isAnonymous: false,
      cacheHit: false, promptCacheReadTokens: 84213, promptCacheWriteTokens: 0,
      responseTimeMs: 1200,
    });

    const row = insert.mock.calls[0][0];
    expect(row.cache_hit).toBe(false);
    expect(row.prompt_cache_read_tokens).toBe(84213);
  });

  it('defaults prompt-cache fields to 0 when a caller omits them', async () => {
    const insert = makeInsert(() => Promise.resolve({ error: null }));
    await logAnalytics({ userId: 'u1', query: 'q', modelId: 'm', tokensUsed: 1, cacheHit: false });
    const row = insert.mock.calls[0][0];
    expect(row.prompt_cache_read_tokens).toBe(0);
    expect(row.prompt_cache_write_tokens).toBe(0);
  });
});

describe('logAnalytics — unapplied migration', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('retries without the new columns so the row still lands', async () => {
    // Code can reach production before the SQL does. Losing the prompt-cache
    // detail is acceptable; losing the analytics row is not.
    const insert = vi.fn()
      .mockResolvedValueOnce({ error: { code: 'PGRST204', message: "Could not find the 'prompt_cache_read_tokens' column" } })
      .mockResolvedValueOnce({ error: null });
    vi.spyOn(supabase, 'from').mockReturnValue({ insert });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await logAnalytics({ userId: 'u1', query: 'q', modelId: 'm', tokensUsed: 5, cacheHit: false });

    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[1][0]).not.toHaveProperty('prompt_cache_read_tokens');
    expect(insert.mock.calls[1][0].tokens_used).toBe(5);
    expect(warn).toHaveBeenCalled();
  });

  it('does not retry on an unrelated failure', async () => {
    // A retry on, say, an auth error would just double the failed writes.
    const insert = vi.fn().mockResolvedValue({ error: { code: '42501', message: 'permission denied' } });
    vi.spyOn(supabase, 'from').mockReturnValue({ insert });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await logAnalytics({ userId: 'u1', query: 'q', modelId: 'm', tokensUsed: 5, cacheHit: false });

    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('never throws out of the analytics path', async () => {
    // Analytics must never be able to fail a user's chat turn.
    vi.spyOn(supabase, 'from').mockReturnValue({ insert: () => Promise.reject(new Error('network down')) });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      logAnalytics({ userId: 'u1', query: 'q', modelId: 'm', tokensUsed: 5, cacheHit: false })
    ).resolves.toBeUndefined();
  });
});
