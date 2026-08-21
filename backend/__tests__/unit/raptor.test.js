// ============================================================
// FILE: backend/__tests__/unit/raptor.test.js
// PURPOSE: RAPTOR tree construction and how summary nodes behave in retrieval.
//
//   Two things matter beyond "does it build":
//
//   1. Clustering must be DETERMINISTIC. An unseeded k-means reshuffles the
//      tree on every rebuild, silently changing what users retrieve for no
//      reason.
//
//   2. A summary must never displace the passage that actually contains the
//      answer. Summaries are model-written synthesis; at comparable relevance
//      the primary text wins, and synthesis can never fill the whole context.
// ============================================================

const dispatcher = require('../../services/ai/dispatcher.service');
const raptor = require('../../services/raptor.service');

const ENV_SNAPSHOT = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ENV_SNAPSHOT };
  process.env.MISTRAL_SUMMARY_API_KEY = 'test-mistral';
  process.env.OPENROUTER_API_KEY = 'test-openrouter';
});

afterEach(() => { process.env = { ...ENV_SNAPSHOT }; });

// Three tight, well-separated groups in a small vector space.
const VECTORS = [
  [1, 0, 0, 0], [0.95, 0.05, 0, 0], [0.9, 0.1, 0, 0],
  [0, 1, 0, 0], [0.05, 0.95, 0, 0],
  [0, 0, 1, 0], [0, 0, 0.97, 0.03],
];

const normalise = (clusters) =>
  clusters.map((c) => [...c].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);

describe('kMeans', () => {
  it('recovers the natural groups', () => {
    expect(normalise(raptor.kMeans(VECTORS, 3))).toEqual([[0, 1, 2], [3, 4], [5, 6]]);
  });

  it('is deterministic across runs', () => {
    // Without a seeded PRNG a rebuild silently reshuffles the whole tree.
    const a = normalise(raptor.kMeans(VECTORS, 3));
    const b = normalise(raptor.kMeans(VECTORS, 3));
    const c = normalise(raptor.kMeans(VECTORS, 3));
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('returns one cluster per vector when k >= n', () => {
    expect(raptor.kMeans(VECTORS, 99)).toHaveLength(VECTORS.length);
  });

  it('returns a single cluster for k <= 1', () => {
    expect(raptor.kMeans(VECTORS, 1)).toEqual([[0, 1, 2, 3, 4, 5, 6]]);
  });

  it('handles an empty input', () => {
    expect(raptor.kMeans([], 3)).toEqual([]);
  });

  it('never emits an empty cluster', () => {
    for (const k of [2, 3, 4, 5]) {
      expect(raptor.kMeans(VECTORS, k).every((c) => c.length > 0)).toBe(true);
    }
  });

  it('assigns every input exactly once', () => {
    const all = raptor.kMeans(VECTORS, 3).flat().sort((a, b) => a - b);
    expect(all).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('cosine', () => {
  it('is 1 for identical direction and 0 for orthogonal', () => {
    expect(raptor.cosine([1, 0], [2, 0])).toBeCloseTo(1, 10);
    expect(raptor.cosine([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it('does not divide by zero on a zero vector', () => {
    expect(Number.isFinite(raptor.cosine([0, 0], [1, 1]))).toBe(true);
  });
});

describe('summaryChain', () => {
  it('leads with the free-quota model', () => {
    expect(raptor.summaryChain()[0].provider).toBe('mistral');
  });

  it('drops entries with no key', () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(raptor.summaryChain().every((m) => m.provider !== 'openrouter')).toBe(true);
  });
});

describe('summarizeCluster', () => {
  it('returns the summary and the tokens it cost', async () => {
    vi.spyOn(dispatcher, 'dispatchToAI').mockResolvedValue({ text: 'a summary', tokensUsed: 90 });

    const res = await raptor.summarizeCluster(['chunk a', 'chunk b'], { level: 1 });

    expect(res.text).toBe('a summary');
    expect(res.tokensUsed).toBe(90);
  });

  it('never offers the chat tool schema', async () => {
    // With tools attached the model can answer with a tool call instead of
    // prose, which arrives here as an empty summary.
    const dispatch = vi.spyOn(dispatcher, 'dispatchToAI').mockResolvedValue({ text: 'ok', tokensUsed: 1 });

    await raptor.summarizeCluster(['x'], { level: 1 });

    expect(dispatch.mock.calls[0][3]).toEqual({ disableTools: true });
  });

  it('falls through to the paid model when the free one fails', async () => {
    const dispatch = vi.spyOn(dispatcher, 'dispatchToAI')
      .mockRejectedValueOnce(new Error('mistral down'))
      .mockResolvedValueOnce({ text: 'recovered', tokensUsed: 40 });

    const res = await raptor.summarizeCluster(['x'], { level: 1 });

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(res.text).toBe('recovered');
  });

  it('returns null when every model fails, rather than a placeholder', async () => {
    vi.spyOn(dispatcher, 'dispatchToAI').mockRejectedValue(new Error('all down'));

    // A failed summary must be dropped. Writing "summary unavailable" into the
    // index would make it retrievable and citable as a source.
    const res = await raptor.summarizeCluster(['x'], { level: 1 });
    expect(res.text).toBeNull();
  });

  it('propagates cancellation', async () => {
    vi.spyOn(dispatcher, 'dispatchToAI').mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' })
    );
    await expect(raptor.summarizeCluster(['x'], { level: 1 })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('configuration', () => {
  it('reads env per call rather than capturing it at import', () => {
    process.env.RAPTOR_BRANCH_FACTOR = '9';
    expect(raptor.cfg().branchFactor).toBe(9);
    process.env.RAPTOR_BRANCH_FACTOR = '4';
    expect(raptor.cfg().branchFactor).toBe(4);
  });

  it('can be disabled', () => {
    process.env.RAPTOR_ENABLED = 'false';
    expect(raptor.isEnabled()).toBe(false);
  });
});
