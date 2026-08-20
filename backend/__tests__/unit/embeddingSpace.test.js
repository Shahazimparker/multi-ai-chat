// ============================================================
// FILE: backend/__tests__/unit/embeddingSpace.test.js
// PURPOSE: Embedding space resolution + embedText provider failover.
//          The invariant under test: a returned vector is always usable
//          against rows tagged with the returned `space`, and failover never
//          crosses a space boundary.
// ============================================================

const axios = require('axios');
const {
  spaceForProvider,
  resolveProviderChain,
  padVector,
  LEGACY_SPACE,
  VECTOR_COLUMN_DIMS,
} = require('../../config/embedding');
const { embedText, clearEmbeddingCache } = require('../../services/rag.service');

const nativeVector = (n) => new Array(n).fill(0).map((_, i) => (i % 7) / 7);

const okResponse = (vector, tokens = 11) => ({
  data: { data: [{ embedding: vector }], usage: { prompt_tokens: tokens } },
});

const httpError = (status, message = 'boom') => {
  const err = new Error(message);
  err.response = { status, data: { error: message } };
  return err;
};

let envBackup;

beforeEach(() => {
  envBackup = { ...process.env };
  clearEmbeddingCache();
  vi.restoreAllMocks();
});

afterEach(() => {
  process.env = envBackup;
  clearEmbeddingCache();
});

describe('embedding space resolution', () => {
  it('maps openrouter and openai onto one space — they are the same model', () => {
    expect(spaceForProvider('openrouter')).toBe('openai-te3-small');
    expect(spaceForProvider('openai')).toBe('openai-te3-small');
    expect(spaceForProvider('openrouter')).toBe(spaceForProvider('openai'));
  });

  it('keeps gemini and mistral in distinct spaces', () => {
    expect(spaceForProvider('gemini')).toBe('gemini-embed-001');
    expect(spaceForProvider('mistral')).toBe('mistral-embed');
    expect(spaceForProvider('gemini')).not.toBe(spaceForProvider('openrouter'));
  });

  it('falls back to the default space for unknown input', () => {
    expect(spaceForProvider('nope')).toBe(LEGACY_SPACE);
    expect(spaceForProvider(undefined)).toBe(LEGACY_SPACE);
  });
});

describe('resolveProviderChain', () => {
  it('offers openai as failover for openrouter when both keys exist', () => {
    process.env.OPENROUTER_API_KEY = 'a';
    process.env.OPENAI_API_KEY = 'b';
    expect(resolveProviderChain('openrouter')).toEqual(['openrouter', 'openai']);
  });

  it('puts the requested provider first', () => {
    process.env.OPENROUTER_API_KEY = 'a';
    process.env.OPENAI_API_KEY = 'b';
    expect(resolveProviderChain('openai')).toEqual(['openai', 'openrouter']);
  });

  it('never offers a cross-space provider as failover', () => {
    process.env.OPENROUTER_API_KEY = 'a';
    process.env.OPENAI_API_KEY = 'b';
    process.env.GEMINI_API_KEY = 'c';
    process.env.MISTRAL_API_KEY = 'd';

    // gemini is alone in its space: no failover, even with every key present.
    expect(resolveProviderChain('gemini')).toEqual(['gemini']);
    expect(resolveProviderChain('mistral')).toEqual(['mistral']);
    expect(resolveProviderChain('openrouter')).not.toContain('gemini');
  });

  it('drops providers with no API key configured', () => {
    delete process.env.OPENAI_API_KEY;
    process.env.OPENROUTER_API_KEY = 'a';
    expect(resolveProviderChain('openrouter')).toEqual(['openrouter']);
  });

  it('returns an empty chain when nothing in the space is configured', () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(resolveProviderChain('openrouter')).toEqual([]);
  });
});

describe('padVector', () => {
  it('pads a native gemini vector out to the column width', () => {
    const padded = padVector(nativeVector(768));
    expect(padded).toHaveLength(VECTOR_COLUMN_DIMS);
    expect(padded.slice(768).every((v) => v === 0)).toBe(true);
  });

  it('preserves cosine similarity exactly (padding is lossless)', () => {
    const a = nativeVector(768);
    const b = nativeVector(768).map((v, i) => v + (i % 3) * 0.01);

    const cosine = (x, y) => {
      const dot = x.reduce((s, v, i) => s + v * y[i], 0);
      const na = Math.sqrt(x.reduce((s, v) => s + v * v, 0));
      const nb = Math.sqrt(y.reduce((s, v) => s + v * v, 0));
      return dot / (na * nb);
    };

    expect(cosine(padVector(a), padVector(b))).toBeCloseTo(cosine(a, b), 12);
  });

  it('leaves a full-width vector untouched', () => {
    const full = nativeVector(VECTOR_COLUMN_DIMS);
    expect(padVector(full)).toHaveLength(VECTOR_COLUMN_DIMS);
  });
});

describe('embedText failover', () => {
  it('reports the space and the provider that actually served the call', async () => {
    process.env.OPENROUTER_API_KEY = 'a';
    vi.spyOn(axios, 'post').mockResolvedValue(okResponse(nativeVector(1536)));

    const res = await embedText('hello', 'openrouter', 3, null, 'user-1');

    expect(res.provider).toBe('openrouter');
    expect(res.space).toBe('openai-te3-small');
    expect(res.vector).toHaveLength(VECTOR_COLUMN_DIMS);
  });

  it('falls over to openai when openrouter fails, staying in-space', async () => {
    process.env.OPENROUTER_API_KEY = 'a';
    process.env.OPENAI_API_KEY = 'b';

    const post = vi.spyOn(axios, 'post').mockImplementation(async (url) => {
      if (String(url).includes('openrouter.ai')) throw httpError(500, 'upstream down');
      return okResponse(nativeVector(1536));
    });

    const res = await embedText('hello', 'openrouter', 0, null, 'user-2');

    expect(post).toHaveBeenCalledTimes(2);
    expect(res.provider).toBe('openai');
    // The whole point: the fallback vector is still comparable to rows already
    // indexed under the requested space, so nothing needs re-indexing.
    expect(res.space).toBe('openai-te3-small');
  });

  it('returns null once every provider in the space has failed', async () => {
    process.env.OPENROUTER_API_KEY = 'a';
    process.env.OPENAI_API_KEY = 'b';
    vi.spyOn(axios, 'post').mockRejectedValue(httpError(500, 'everything is down'));

    const res = await embedText('hello', 'openrouter', 0, null, 'user-3');
    expect(res).toBeNull();
  });

  it('does not fail over on an over-length input — it rethrows for the caller to split', async () => {
    process.env.OPENROUTER_API_KEY = 'a';
    process.env.OPENAI_API_KEY = 'b';

    const post = vi.spyOn(axios, 'post').mockRejectedValue(
      httpError(400, 'This model\'s maximum context length is 8192 tokens')
    );

    await expect(embedText('x'.repeat(50), 'openrouter', 0, null, 'user-4'))
      .rejects.toMatchObject({ code: 'EMBED_INPUT_TOO_LONG' });

    // fileUpload splits and retries on this code; burning the sibling provider
    // on an input that is too long for the model helps nobody.
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('does not fail over when the caller aborts', async () => {
    process.env.OPENROUTER_API_KEY = 'a';
    process.env.OPENAI_API_KEY = 'b';

    const abortErr = Object.assign(new Error('aborted'), { name: 'CanceledError' });
    const post = vi.spyOn(axios, 'post').mockRejectedValue(abortErr);

    await expect(embedText('hello', 'openrouter', 0, null, 'user-5'))
      .rejects.toMatchObject({ name: 'CanceledError' });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('shares one cache entry across providers in the same space', async () => {
    process.env.OPENROUTER_API_KEY = 'a';
    process.env.OPENAI_API_KEY = 'b';
    const post = vi.spyOn(axios, 'post').mockResolvedValue(okResponse(nativeVector(1536)));

    const first = await embedText('same text', 'openrouter', 0, null, 'user-6');
    const second = await embedText('same text', 'openai', 0, null, 'user-6');

    expect(post).toHaveBeenCalledTimes(1);
    expect(second.vector).toEqual(first.vector);
    expect(second.tokensUsed).toBe(0); // served from cache, nothing billed
  });

  it('does not share a cache entry across different spaces', async () => {
    process.env.OPENROUTER_API_KEY = 'a';
    process.env.MISTRAL_API_KEY = 'm';
    const post = vi.spyOn(axios, 'post').mockResolvedValue(okResponse(nativeVector(1536)));

    await embedText('same text', 'openrouter', 0, null, 'user-7');
    await embedText('same text', 'mistral', 0, null, 'user-7').catch(() => null);

    // A mistral request must never be answered with an openai vector.
    expect(post.mock.calls.some((c) => String(c[0]).includes('mistral'))).toBe(true);
  });

  it('keeps caches separate per user', async () => {
    process.env.OPENROUTER_API_KEY = 'a';
    const post = vi.spyOn(axios, 'post').mockResolvedValue(okResponse(nativeVector(1536)));

    await embedText('shared text', 'openrouter', 0, null, 'user-A');
    await embedText('shared text', 'openrouter', 0, null, 'user-B');

    expect(post).toHaveBeenCalledTimes(2);
  });
});
