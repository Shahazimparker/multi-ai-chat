// ============================================================
// FILE: backend/__tests__/unit/queryTransform.test.js
// PURPOSE: Query expansion (multi-query) and HyDE.
//
//   Both rewrite the user's question to improve retrieval recall. The
//   non-negotiable property for both: the ORIGINAL query survives. A rewriter
//   having an opinion must never cost the user their actual wording, and a
//   rewriter being down must never break retrieval.
// ============================================================

const dispatcher = require('../../services/ai/dispatcher.service');
const {
  expandQuery,
  generateHypotheticalAnswer,
  parseLines,
} = require('../../services/queryTransform.service');

const reply = (text) => ({ text, tokensUsed: 42 });

// Several tests clear provider keys to exercise the chain. Snapshot and restore
// so the order tests run in cannot change their outcome.
const ENV_SNAPSHOT = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ENV_SNAPSHOT };
  process.env.OPENROUTER_API_KEY = 'test-key';
});

afterEach(() => {
  process.env = { ...ENV_SNAPSHOT };
});

describe('parseLines', () => {
  it('strips bullets, numbering and quotes the model adds unbidden', () => {
    const raw = [
      '1. first rewrite',
      '- second rewrite',
      '• third rewrite',
      '"fourth rewrite"',
    ].join('\n');

    expect(parseLines(raw, 5)).toEqual([
      'first rewrite', 'second rewrite', 'third rewrite', 'fourth rewrite',
    ]);
  });

  it('drops duplicates case-insensitively', () => {
    // Near-identical rewrites cost a full retrieval pass and add nothing.
    expect(parseLines('Rate Limits\nrate limits\nToken caps', 5))
      .toEqual(['Rate Limits', 'Token caps']);
  });

  it('honours the limit and discards junk lines', () => {
    expect(parseLines('a\nvalid query one\nvalid query two\nvalid query three', 2))
      .toEqual(['valid query one', 'valid query two']);
  });
});

describe('expandQuery', () => {
  it('returns the original query first, followed by the variants', async () => {
    vi.spyOn(dispatcher, 'dispatchToAI').mockResolvedValue(
      reply('mxgraph decision shape style\nflowchart diamond node syntax\nconditional block style string')
    );

    const { queries, expanded } = await expandQuery('how do I make a diamond box?', { count: 3 });

    expect(expanded).toBe(true);
    expect(queries[0]).toBe('how do I make a diamond box?');
    expect(queries).toHaveLength(4);
    expect(queries).toContain('mxgraph decision shape style');
  });

  it('bills the tokens the rewrite actually consumed', async () => {
    vi.spyOn(dispatcher, 'dispatchToAI').mockResolvedValue(reply('alt one\nalt two'));
    const { tokensUsed } = await expandQuery('q', { count: 2 });
    expect(tokensUsed).toBe(42);
  });

  it('drops a variant identical to the original', async () => {
    vi.spyOn(dispatcher, 'dispatchToAI').mockResolvedValue(reply('Rate limits\nsomething else'));

    const { queries } = await expandQuery('rate limits', { count: 2 });
    expect(queries.filter((q) => q.toLowerCase() === 'rate limits')).toHaveLength(1);
  });

  it('falls back to the original query when the model fails', async () => {
    vi.spyOn(dispatcher, 'dispatchToAI').mockRejectedValue(new Error('provider 503'));

    const { queries, expanded } = await expandQuery('rate limits');

    // Retrieval must still run. Losing expansion costs recall, not the search.
    expect(queries).toEqual(['rate limits']);
    expect(expanded).toBe(false);
  });

  it('falls back when the model returns nothing usable', async () => {
    vi.spyOn(dispatcher, 'dispatchToAI').mockResolvedValue(reply('   \n\n  '));
    const { queries, expanded } = await expandQuery('rate limits');
    expect(queries).toEqual(['rate limits']);
    expect(expanded).toBe(false);
  });

  it('skips the rewrite when no provider in the chain is configured', async () => {
    // Keys are read per call, so clearing them takes effect immediately — no
    // module reset needed, and no stale value captured at require time.
    // Every provider must be cleared: the chain crosses providers, so removing
    // only OpenRouter leaves Gemini and Mistral still able to serve it.
    for (const k of [
      'OPENROUTER_API_KEY', 'GEMINI_SUMMARY_API_KEY', 'GEMINI_API_KEY',
      'MISTRAL_SUMMARY_API_KEY', 'MISTRAL_API_KEY',
    ]) delete process.env[k];

    const dispatch = vi.spyOn(dispatcher, 'dispatchToAI');

    const { queries, expanded } = await expandQuery('rate limits');

    expect(dispatch).not.toHaveBeenCalled();
    expect(queries).toEqual(['rate limits']);
    expect(expanded).toBe(false);
  });

  it('skips very long queries, which already carry plenty of signal', async () => {
    const dispatch = vi.spyOn(dispatcher, 'dispatchToAI');
    const { expanded } = await expandQuery('x'.repeat(900));
    expect(dispatch).not.toHaveBeenCalled();
    expect(expanded).toBe(false);
  });

  it('propagates cancellation rather than swallowing it', async () => {
    vi.spyOn(dispatcher, 'dispatchToAI').mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' })
    );
    await expect(expandQuery('rate limits')).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('generateHypotheticalAnswer (HyDE)', () => {
  it('returns the hypothetical passage', async () => {
    vi.spyOn(dispatcher, 'dispatchToAI').mockResolvedValue(
      reply('The decision shape is declared with style=shape=mxgraph.flowchart.decision.')
    );

    const { hypothetical, tokensUsed } = await generateHypotheticalAnswer('how do I make a diamond box?');

    expect(hypothetical).toContain('mxgraph.flowchart.decision');
    expect(tokensUsed).toBe(42);
  });

  it('returns null on failure so the caller keeps the real query', async () => {
    vi.spyOn(dispatcher, 'dispatchToAI').mockRejectedValue(new Error('provider 500'));
    const { hypothetical } = await generateHypotheticalAnswer('q');
    expect(hypothetical).toBeNull();
  });

  it('returns null on an empty generation', async () => {
    vi.spyOn(dispatcher, 'dispatchToAI').mockResolvedValue(reply('  '));
    const { hypothetical } = await generateHypotheticalAnswer('q');
    expect(hypothetical).toBeNull();
  });

  it('propagates cancellation', async () => {
    vi.spyOn(dispatcher, 'dispatchToAI').mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'CanceledError' })
    );
    await expect(generateHypotheticalAnswer('q')).rejects.toMatchObject({ name: 'CanceledError' });
  });
});

// ── Model fallback chain ─────────────────────────────────────
// This runs on every knowledge-base search, so a rate limit on one cheap model
// would otherwise disable expansion for every user at once.
describe('model fallback', () => {
  const { transformChain } = require('../../services/queryTransform.service');

  const rateLimit = () => {
    const err = new Error('Rate limit exceeded');
    err.response = { status: 429 };
    return err;
  };

  it('moves to the next model on a 429', async () => {
    const dispatch = vi.spyOn(dispatcher, 'dispatchToAI')
      .mockRejectedValueOnce(rateLimit())
      .mockResolvedValueOnce(reply(['alt one', 'alt two'].join(String.fromCharCode(10))));

    const { queries, expanded } = await expandQuery('rate limits', { count: 2 });

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(expanded).toBe(true);
    expect(queries).toContain('alt one');
  });

  it('crosses providers when OpenRouter is unavailable entirely', async () => {
    const dispatch = vi.spyOn(dispatcher, 'dispatchToAI')
      .mockRejectedValueOnce(rateLimit())
      .mockRejectedValueOnce(rateLimit())
      .mockResolvedValueOnce(reply('recovered variant'));

    const { expanded } = await expandQuery('rate limits', { count: 1 });

    expect(expanded).toBe(true);
    // Third attempt must not be an openrouter model, or an account-wide limit
    // would take the whole chain down.
    expect(dispatch.mock.calls[2][0].provider).not.toBe('openrouter');
  });

  it('degrades to the original query only after every model fails', async () => {
    const dispatch = vi.spyOn(dispatcher, 'dispatchToAI').mockRejectedValue(rateLimit());

    const { queries, expanded } = await expandQuery('rate limits');

    expect(dispatch.mock.calls.length).toBeGreaterThan(1);
    expect(queries).toEqual(['rate limits']);
    expect(expanded).toBe(false);
  });

  it('stops the chain immediately on cancellation', async () => {
    const dispatch = vi.spyOn(dispatcher, 'dispatchToAI').mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' })
    );

    await expect(expandQuery('rate limits')).rejects.toMatchObject({ name: 'AbortError' });
    // Cancellation is the user's intent — never retried against another model.
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('puts an explicit QUERY_TRANSFORM_MODEL first without duplicating it', async () => {
    process.env.QUERY_TRANSFORM_MODEL = 'google/gemini-2.5-flash-lite';
    const chain = transformChain();

    expect(chain[0].model).toBe('google/gemini-2.5-flash-lite');
    const ids = chain.map((c) => `${c.provider}:${c.model}`);
    expect(new Set(ids).size).toBe(ids.length);
    delete process.env.QUERY_TRANSFORM_MODEL;
  });

  it('drops entries with no API key configured', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const chain = transformChain();
    expect(chain.every((c) => c.provider !== 'openrouter')).toBe(true);
  });
});
