// FILE: backend/__tests__/unit/promptCache.test.js
// PURPOSE: Every provider names the same cache metric differently, and reading
//          the wrong name fails silently rather than throwing — which is how the
//          OpenAI adapter came to look for Anthropic's fields and report a flat
//          zero forever. These lock each dialect.

const {
  anthropicCacheControl,
  applyAnthropicHistoryBreakpoint,
  extractCacheUsage,
  withCacheUsage,
  buildPromptCacheKey,
  describeCacheUsage,
  ANTHROPIC_MIN_CACHEABLE_TOKENS,
} = require('../../services/ai/promptCache.service');

describe('extractCacheUsage — provider dialects', () => {
  it('reads Anthropic writes and reads', () => {
    const r = extractCacheUsage({
      cache_creation_input_tokens: 3632,
      cache_read_input_tokens: 1024,
    });
    expect(r.cacheCreationTokens).toBe(3632);
    expect(r.cacheReadTokens).toBe(1024);
    expect(r.cacheHit).toBe(true);
  });

  it('reads OpenAI prompt_tokens_details.cached_tokens', () => {
    const r = extractCacheUsage({
      prompt_tokens: 2048,
      prompt_tokens_details: { cached_tokens: 1800 },
    });
    expect(r.cacheReadTokens).toBe(1800);
    expect(r.cacheHit).toBe(true);
    // OpenAI does not bill a separate cache write, so there is nothing to report.
    expect(r.cacheCreationTokens).toBe(0);
  });

  it('reads DeepSeek prompt_cache_hit_tokens', () => {
    // The saving this exposes is the largest available in the app: a DeepSeek
    // cache hit bills at $0.014/M against $0.14/M uncached.
    const r = extractCacheUsage({
      total_tokens: 5000,
      prompt_cache_hit_tokens: 3200,
      prompt_cache_miss_tokens: 800,
    });
    expect(r.cacheReadTokens).toBe(3200);
    expect(r.cacheHit).toBe(true);
  });

  it('reads Gemini cachedContentTokenCount', () => {
    const r = extractCacheUsage({ totalTokenCount: 900, cachedContentTokenCount: 512 });
    expect(r.cacheReadTokens).toBe(512);
    expect(r.cacheHit).toBe(true);
  });

  it('reports a clean miss when a provider sends usage with no cache fields', () => {
    const r = extractCacheUsage({ total_tokens: 1234 });
    expect(r).toEqual({ cacheCreationTokens: 0, cacheReadTokens: 0, cacheHit: false });
  });

  it('never throws on absent or malformed usage', () => {
    expect(extractCacheUsage(null).cacheHit).toBe(false);
    expect(extractCacheUsage(undefined).cacheHit).toBe(false);
    expect(extractCacheUsage('nonsense').cacheHit).toBe(false);
    expect(extractCacheUsage({ prompt_tokens_details: null }).cacheReadTokens).toBe(0);
    expect(extractCacheUsage({ cache_read_input_tokens: 'abc' }).cacheReadTokens).toBe(0);
  });

  it('does not mistake a zero cache hit for a hit', () => {
    const r = extractCacheUsage({ prompt_tokens_details: { cached_tokens: 0 } });
    expect(r.cacheHit).toBe(false);
  });
});

describe('withCacheUsage', () => {
  it('merges normalised cache fields into an adapter result', () => {
    const out = withCacheUsage(
      { text: 'hi', tokensUsed: 10 },
      { prompt_cache_hit_tokens: 64 }
    );
    expect(out.text).toBe('hi');
    expect(out.tokensUsed).toBe(10);
    expect(out.cacheReadTokens).toBe(64);
  });
});

describe('buildPromptCacheKey', () => {
  it('keys by conversation so every turn routes to the same backend', () => {
    expect(buildPromptCacheKey('topic-1', 'user-9')).toBe('multiaichat:topic:topic-1');
  });

  it('falls back to the user when there is no topic', () => {
    expect(buildPromptCacheKey(null, 'user-9')).toBe('multiaichat:topic:user-9');
  });

  it('is undefined for anonymous one-off calls rather than a shared constant', () => {
    // A single global key would funnel unrelated traffic onto one backend and
    // blow past the per-key rate OpenAI recommends.
    expect(buildPromptCacheKey(null, null)).toBeUndefined();
  });
});

describe('describeCacheUsage', () => {
  it('says plainly when nothing was cached', () => {
    expect(describeCacheUsage({ cacheCreationTokens: 0, cacheReadTokens: 0 }, 5000))
      .toContain('no hit');
  });

  it('reports reads as a share of the prompt', () => {
    const line = describeCacheUsage({ cacheReadTokens: 4000 }, 8000);
    expect(line).toContain('4000');
    expect(line).toContain('50%');
  });

  it('does not divide by zero when prompt size is unknown', () => {
    expect(() => describeCacheUsage({ cacheReadTokens: 100 }, 0)).not.toThrow();
  });
});

describe('Anthropic minimum', () => {
  it('matches the documented Opus/Sonnet floor', () => {
    // Anthropic accepts a breakpoint below this and then ignores it silently,
    // so the adapters check against it before paying the 1.25x write rate.
    expect(ANTHROPIC_MIN_CACHEABLE_TOKENS).toBe(1024);
  });
});

describe('applyAnthropicHistoryBreakpoint', () => {
  const long = 'word '.repeat(2000); // comfortably over the 1024-token floor

  it('marks the last message before the current turn', () => {
    // Everything ahead of the breakpoint — system plus every prior turn — is
    // then served from cache. The current turn stays fresh.
    const out = applyAnthropicHistoryBreakpoint([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'current question' },
    ], 5000);

    expect(Array.isArray(out[1].content)).toBe(true);
    expect(out[1].content[0].cache_control).toEqual(anthropicCacheControl());
    // The current turn must never carry it — it changes every request.
    expect(out[2].content).toBe('current question');
  });

  it('does nothing below the provider minimum, rather than paying for a dead write', () => {
    const msgs = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ];
    // Anthropic bills cache writes at 1.25x; a write under the floor is ignored
    // on read, so it would be pure cost.
    expect(applyAnthropicHistoryBreakpoint(msgs, 500)).toBe(msgs);
  });

  it('does nothing when there is no history yet', () => {
    const msgs = [{ role: 'user', content: long }];
    expect(applyAnthropicHistoryBreakpoint(msgs, 9999)).toBe(msgs);
  });

  it('attaches to the last part of a multimodal turn without disturbing it', () => {
    const out = applyAnthropicHistoryBreakpoint([
      { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'x' } }] },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'and now?' },
    ], 5000);

    expect(out[1].content[0].cache_control).toEqual(anthropicCacheControl());
    expect(out[0].content[1]).toEqual({ type: 'image_url', image_url: { url: 'x' } });
  });

  it('does not mutate the input array', () => {
    const msgs = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ];
    const snapshot = JSON.stringify(msgs);
    applyAnthropicHistoryBreakpoint(msgs, 5000);
    expect(JSON.stringify(msgs)).toBe(snapshot);
  });
});

describe('Anthropic cache TTL', () => {
  it('defaults to the 1-hour cache', () => {
    // The 5-minute default drops exactly the 5-30 minute gap a chat turn
    // commonly lands in. Writes are charged on the delta past the previous
    // breakpoint, so the higher write rate applies to one turn's worth while
    // the read covers the whole history at 0.1x.
    expect(anthropicCacheControl()).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('uses the same control object for every breakpoint', () => {
    // Anthropic requires longer-TTL entries to appear before shorter ones. One
    // shared TTL satisfies that ordering rule by construction; mixing 1h and 5m
    // breakpoints could violate it depending on where they land.
    const a = anthropicCacheControl();
    const b = anthropicCacheControl();
    expect(a).toEqual(b);
  });

  it('carries the TTL onto the history breakpoint', () => {
    const out = applyAnthropicHistoryBreakpoint([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ], 5000);
    expect(out[1].content[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });
});
