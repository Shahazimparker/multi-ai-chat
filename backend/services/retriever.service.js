// ============================================================
// FILE: backend/services/retriever.service.js
// PURPOSE: Standardized retriever interfaces for RAG
//          - VectorRetriever: semantic search
//          - BM25Retriever: keyword search
//          - HybridRetriever: combine both
//          - MetadataRetriever: filter by metadata
//          - RerankerRetriever: rerank with LLM
//          - ChainedRetriever: compose multiple
// ============================================================

/**
 * RetrievalResult — result from retriever
 */
class RetrievalResult {
  constructor(documentId, content, score = 1.0, metadata = {}) {
    this.documentId = documentId;
    this.content = content;
    this.score = score; // 0-1, higher is better
    this.metadata = metadata;
  }
}

const HYBRID_RRF_K = 60;

const tokenizeForRanking = (text) => {
  return String(text || '')
    .toLowerCase()
    .match(/[a-z0-9]+(?:[._-][a-z0-9]+)*/g) || [];
};

const jaccardSimilarity = (tokensA, tokensB) => {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  if (!setA.size || !setB.size) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
};

const buildRankMap = (results, scoreSelector) => {
  return [...results]
    .map((result, idx) => ({
      id: result.documentId ?? idx,
      score: Number(scoreSelector(result, idx)) || 0,
    }))
    .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)))
    .reduce((rankMap, item, rank) => {
      rankMap.set(item.id, rank + 1);
      return rankMap;
    }, new Map());
};

const reciprocalRankFusion = (rankMaps, id, k = HYBRID_RRF_K) => {
  return rankMaps.reduce((sum, rankMap) => {
    const rank = rankMap.get(id);
    return sum + (rank ? 1 / (k + rank) : 0);
  }, 0);
};

/**
 * Base Retriever interface
 */
class Retriever {
  async retrieve(query, options = {}) {
    throw new Error('retrieve() not implemented');
  }

  async retrieveWithScores(query, options = {}) {
    const results = await this.retrieve(query, options);
    return results.map((r) => ({
      ...r,
      score: r.score || 1.0,
    }));
  }

  _normalizeScores(results) {
    if (results.length === 0) return results;

    const scores = results.map((r) => r.score);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const range = maxScore - minScore || 1;

    return results.map((r) => ({
      ...r,
      score: (r.score - minScore) / range,
    }));
  }

  _sortByScore(results, descending = true) {
    return [...results].sort((a, b) =>
      descending ? b.score - a.score : a.score - b.score
    );
  }
}

/**
 * VectorRetriever — semantic search using embeddings
 */
class VectorRetriever extends Retriever {
  constructor(vectorStore, embeddingFn) {
    super();
    this.vectorStore = vectorStore;
    this.embeddingFn = embeddingFn;
  }

  async retrieve(query, options = {}) {
    const {
      topK = 10,
      threshold = 0.0,
      includeMetadata = true,
      includeScores = true,
    } = options;

    if (!query || typeof query === 'string') {
      // Embed query
      const embedding = await this.embeddingFn(query);
      return await this._searchByEmbedding(embedding, { topK, threshold });
    } else {
      // Query is already an embedding
      return await this._searchByEmbedding(query, { topK, threshold });
    }
  }

  async _searchByEmbedding(embedding, options) {
    const result = await this.vectorStore.search(embedding, options);

    if (!result.success) {
      return [];
    }

    return result.results.map(
      (r) =>
        new RetrievalResult(r.id, r.content, r.similarity, r.metadata || {})
    );
  }
}

/**
 * BM25Retriever — lexical/keyword search using TF-IDF
 */
class BM25Retriever extends Retriever {
  constructor(documents = []) {
    super();
    this.documents = documents; // [{ id, content, metadata }]
    this.index = new Map();     // word → [docId1, docId2, ...]
    this.docMap = new Map();    // id → document (O(1) lookup, eliminates N+1)
    this.tokenCache = new Map(); // id → tokenized words (avoids re-tokenizing)
    this._buildIndex();
  }

  _buildIndex() {
    this.index.clear();
    this.docMap.clear();
    this.tokenCache.clear();

    for (const doc of this.documents) {
      this.docMap.set(doc.id, doc);

      const words = this._tokenize(doc.content);
      this.tokenCache.set(doc.id, words);
      const uniqueWords = new Set(words);

      for (const word of uniqueWords) {
        if (!this.index.has(word)) {
          this.index.set(word, []);
        }
        const list = this.index.get(word);
        if (!list.includes(doc.id)) {
          list.push(doc.id);
        }
      }
    }
  }

  _tokenize(text) {
    if (!text) return [];
    return text
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2);
  }

  _calculateTFIDF(queryWords, docId) {
    // O(1) lookup via docMap — no more Array.find()
    const doc = this.docMap.get(docId);
    if (!doc) return 0;

    // Use cached tokens — no re-tokenization
    const docWords = this.tokenCache.get(docId) || [];
    const docWordCount = docWords.length;
    if (docWordCount === 0) return 0;

    let tfidfScore = 0;

    for (const queryWord of queryWords) {
      const matchCount = docWords.filter((w) => w === queryWord).length;
      const tf = matchCount / docWordCount;
      const docsWithWord = this.index.get(queryWord)?.length || 0;
      const idf = Math.log((this.documents.length + 1) / (docsWithWord + 1));
      tfidfScore += tf * idf;
    }

    return tfidfScore;
  }

  async retrieve(query, options = {}) {
    const { topK = 10, threshold = 0.0 } = options;

    const queryWords = this._tokenize(query);
    if (queryWords.length === 0) return [];

    const scores = new Map();

    for (const doc of this.documents) {
      const score = this._calculateTFIDF(queryWords, doc.id);
      if (score >= threshold) {
        scores.set(doc.id, score);
      }
    }

    // Use docMap for O(1) content/metadata lookup — no more repeated Array.find()
    const results = Array.from(scores.entries())
      .map(([docId, score]) => {
        const doc = this.docMap.get(docId);
        return new RetrievalResult(docId, doc?.content, score, doc?.metadata || {});
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return this._normalizeScores(results);
  }

  addDocument(id, content, metadata = {}) {
    const doc = { id, content, metadata };
    this.documents.push(doc);
    // Incremental update — rebuild full index only when needed
    this.docMap.set(id, doc);
    const words = this._tokenize(content);
    this.tokenCache.set(id, words);
    const uniqueWords = new Set(words);
    for (const word of uniqueWords) {
      if (!this.index.has(word)) this.index.set(word, []);
      const list = this.index.get(word);
      if (!list.includes(id)) list.push(id);
    }
  }

  removeDocument(id) {
    const idx = this.documents.findIndex((d) => d.id === id);
    if (idx !== -1) this.documents.splice(idx, 1);
    this.docMap.delete(id);
    this.tokenCache.delete(id);
    // Rebuild full index after removal (less common operation)
    this._buildIndex();
  }
}

/**
 * HybridRetriever — combine vector + BM25 search
 */
class HybridRetriever extends Retriever {
  constructor(vectorRetriever, bm25Retriever, options = {}) {
    super();
    if (!vectorRetriever) throw new Error('HybridRetriever: vectorRetriever is required');
    if (!bm25Retriever) throw new Error('HybridRetriever: bm25Retriever is required');
    this.vectorRetriever = vectorRetriever;
    this.bm25Retriever = bm25Retriever;
    this.vectorWeight = options.vectorWeight ?? 0.6;
    this.bm25Weight = options.bm25Weight ?? 0.4;
    this.jaccardWeight = options.jaccardWeight ?? 0.15;
    this.rrfWeight = options.rrfWeight ?? 0.1;
    this.rrfK = options.rrfK ?? HYBRID_RRF_K;
  }

  async retrieve(query, options = {}) {
    const { topK = 10 } = options;
    const queryTokens = tokenizeForRanking(query);

    // Run both retrievers in parallel for better performance
    const [vectorResults, bm25Results] = await Promise.all([
      this.vectorRetriever.retrieve(query, { topK: topK * 2 }),
      this.bm25Retriever.retrieve(query, { topK: topK * 2 }),
    ]);

    // Normalize scores
    const vectorNorm = this._normalizeScores(vectorResults);
    const bm25Norm = this._normalizeScores(bm25Results);

    // Merge results by docId
    const merged = new Map();

    for (const result of vectorNorm) {
      merged.set(result.documentId, {
        ...result,
        vectorScore: result.score,
        bm25Score: 0,
      });
    }

    for (const result of bm25Norm) {
      if (merged.has(result.documentId)) {
        merged.get(result.documentId).bm25Score = result.score;
      } else {
        merged.set(result.documentId, {
          ...result,
          vectorScore: 0,
          bm25Score: result.score,
        });
      }
    }

    const combinedBase = Array.from(merged.values()).map((r) => ({
      ...r,
      jaccardScore: queryTokens.length > 0
        ? jaccardSimilarity(queryTokens, tokenizeForRanking(r.content))
        : 0,
    }));

    const vectorRankMap = buildRankMap(vectorNorm, (r) => r.score);
    const bm25RankMap = buildRankMap(bm25Norm, (r) => r.score);
    const jaccardRankMap = queryTokens.length > 0
      ? buildRankMap(combinedBase, (r) => r.jaccardScore)
      : new Map();
    const rrfRaw = new Map(combinedBase.map((r) => [
      r.documentId,
      reciprocalRankFusion([vectorRankMap, bm25RankMap, jaccardRankMap], r.documentId, this.rrfK),
    ]));
    const rrfMax = Math.max(1e-9, ...rrfRaw.values());
    const totalWeight = this.vectorWeight + this.bm25Weight + this.jaccardWeight + this.rrfWeight || 1;

    // Calculate combined score
    const combined = combinedBase.map((r) => {
      const rrfScore = rrfRaw.get(r.documentId) / rrfMax;
      return {
        ...r,
        rrfScore,
        score: (
          r.vectorScore * this.vectorWeight +
          r.bm25Score * this.bm25Weight +
          r.jaccardScore * this.jaccardWeight +
          rrfScore * this.rrfWeight
        ) / totalWeight,
      };
    });

    return this._sortByScore(combined).slice(0, topK);
  }
}

/**
 * MetadataRetriever — filter by metadata before retrieving
 */
class MetadataRetriever extends Retriever {
  constructor(baseRetriever) {
    super();
    this.baseRetriever = baseRetriever;
    this.filters = [];
  }

  addFilter(key, value, operator = '==') {
    this.filters.push({ key, value, operator });
    return this;
  }

  _matchesFilter(metadata, filter) {
    const metaValue = metadata[filter.key];

    if (filter.operator === '==') return metaValue === filter.value;
    if (filter.operator === '!=') return metaValue !== filter.value;
    if (filter.operator === 'in') return filter.value.includes(metaValue);
    if (filter.operator === '>' && typeof metaValue === 'number')
      return metaValue > filter.value;
    if (filter.operator === '<' && typeof metaValue === 'number')
      return metaValue < filter.value;

    return true;
  }

  async retrieve(query, options = {}) {
    const results = await this.baseRetriever.retrieve(query, options);

    return results.filter((result) =>
      this.filters.every((filter) => this._matchesFilter(result.metadata, filter))
    );
  }
}

/**
 * RerankerRetriever — rerank results using LLM
 */
class RerankerRetriever extends Retriever {
  constructor(baseRetriever, modelDispatcher, options = {}) {
    super();
    this.baseRetriever = baseRetriever;
    this.modelDispatcher = modelDispatcher;
    this.modelId = options.modelId || 'claude-3-5-sonnet';
    this.rerankerPrompt = options.rerankerPrompt || this._defaultRerankerPrompt;
  }

  _defaultRerankerPrompt(query, documents) {
    return `Given the query: "${query}"

Rate the relevance of these documents on a scale of 0-1:

${documents
  .map(
    (doc, i) =>
      `Document ${i + 1}:
"${doc.content.slice(0, 200)}..."

Relevance score: `
  )
  .join('\n')}

Respond with a JSON array of scores in order.`;
  }

  async retrieve(query, options = {}) {
    const { topK = 10, preRetrievalTopK = 50 } = options;

    // Get initial results
    const results = await this.baseRetriever.retrieve(query, {
      topK: preRetrievalTopK,
    });

    if (results.length === 0) return results;

    // Rerank with LLM
    const prompt = this._defaultRerankerPrompt(query, results);

    try {
      const response = await this.modelDispatcher.dispatch({
        modelId: this.modelId,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.0,
      });

      const scoreText = response?.text || response?.content;
      if (!scoreText) {
        console.warn('[RerankerRetriever] Empty response from model, returning original results');
        return results.slice(0, topK);
      }

      // Extract JSON array from response (model may wrap it in text)
      const jsonMatch = scoreText.match(/\[[\s\S]*?\]/);
      if (!jsonMatch) {
        console.warn('[RerankerRetriever] No JSON array found in response, returning original results');
        return results.slice(0, topK);
      }

      let scores;
      try {
        scores = JSON.parse(jsonMatch[0]);
      } catch (parseErr) {
        console.warn('[RerankerRetriever] Failed to parse scores JSON, returning original results');
        return results.slice(0, topK);
      }

      if (!Array.isArray(scores)) {
        console.warn('[RerankerRetriever] Scores not an array, returning original results');
        return results.slice(0, topK);
      }

      // Apply new scores, fall back to original score if missing/invalid
      const reranked = results.map((result, i) => ({
        ...result,
        score: typeof scores[i] === 'number' ? scores[i] : result.score,
      }));

      return this._sortByScore(reranked).slice(0, topK);
    } catch (err) {
      console.warn('[RerankerRetriever] Reranking failed, returning original results:', err.message);
      return results.slice(0, topK);
    }
  }
}

/**
 * ChainedRetriever — compose multiple retrievers
 */
class ChainedRetriever extends Retriever {
  constructor() {
    super();
    this.retrievers = [];
  }

  add(retriever) {
    this.retrievers.push(retriever);
    return this;
  }

  async retrieve(query, options = {}) {
    const { topK = 10, strategy = 'all' } = options;

    if (strategy === 'first') {
      // Use first retriever only
      return await this.retrievers[0].retrieve(query, { topK });
    }

    if (strategy === 'all') {
      // Combine all retrievers
      const allResults = [];

      for (const retriever of this.retrievers) {
        const results = await retriever.retrieve(query, { topK: topK * 2 });
        allResults.push(...results);
      }

      // Deduplicate and rerank
      const merged = new Map();
      for (const result of allResults) {
        if (merged.has(result.documentId)) {
          const existing = merged.get(result.documentId);
          existing.score = Math.max(existing.score, result.score);
        } else {
          merged.set(result.documentId, result);
        }
      }

      return this._sortByScore(Array.from(merged.values())).slice(0, topK);
    }

    throw new Error(`Unknown chaining strategy: ${strategy}`);
  }
}

/**
 * Factory function
 */
const createRetriever = (type = 'vector', options = {}) => {
  if (type === 'vector') {
    return new VectorRetriever(options.vectorStore, options.embeddingFn);
  }

  if (type === 'bm25') {
    return new BM25Retriever(options.documents || []);
  }

  if (type === 'hybrid') {
    return new HybridRetriever(
      options.vectorRetriever,
      options.bm25Retriever,
      options
    );
  }

  if (type === 'metadata') {
    return new MetadataRetriever(options.baseRetriever);
  }

  if (type === 'reranker') {
    return new RerankerRetriever(
      options.baseRetriever,
      options.modelDispatcher,
      options
    );
  }

  if (type === 'chained') {
    return new ChainedRetriever();
  }

  throw new Error(`Unknown retriever type: ${type}`);
};

module.exports = {
  Retriever,
  RetrievalResult,
  VectorRetriever,
  BM25Retriever,
  HybridRetriever,
  MetadataRetriever,
  RerankerRetriever,
  ChainedRetriever,
  createRetriever,
};
