// vitest globals: describe, it, expect

const { HybridRetriever, RetrievalResult } = require('../../services/retriever.service');

class StubRetriever {
  constructor(results) {
    this.results = results;
  }

  async retrieve(query, options = {}) {
    return this.results.slice(0, options.topK || this.results.length);
  }
}

describe('HybridRetriever', () => {
  it('blends vector, BM25, Jaccard, and RRF signals', async () => {
    const vectorRetriever = new StubRetriever([
      new RetrievalResult(1, 'general semantic match about systems', 0.98),
      new RetrievalResult(2, 'database schema migration guide', 0.86),
      new RetrievalResult(3, 'unrelated text', 0.2),
    ]);

    const bm25Retriever = new StubRetriever([
      new RetrievalResult(2, 'database schema migration guide', 0.99),
      new RetrievalResult(1, 'general semantic match about systems', 0.55),
      new RetrievalResult(3, 'unrelated text', 0.1),
    ]);

    const hybrid = new HybridRetriever(vectorRetriever, bm25Retriever);
    const results = await hybrid.retrieve('database schema migration', { topK: 3 });

    expect(results).toHaveLength(3);
    expect(results[0].documentId).toBe(2);
    expect(results[0].jaccardScore).toBeGreaterThan(0);
    expect(results[0].rrfScore).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('returns empty array when both retrievers return nothing', async () => {
    const hybrid = new HybridRetriever(new StubRetriever([]), new StubRetriever([]));
    await expect(hybrid.retrieve('database schema migration', { topK: 3 })).resolves.toEqual([]);
  });
});
