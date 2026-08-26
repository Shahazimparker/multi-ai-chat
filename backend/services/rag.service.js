// ============================================================
// FILE: backend/services/rag.service.js
// PURPOSE: Retrieval-Augmented Generation using pgvector
//          Embeds queries with OpenAI, searches similar docs,
//          injects relevant context into AI prompt
// ============================================================

const axios = require('axios');
const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase = require('../config/supabase');
const { trimTextByTokens, estimateTokens } = require('./tokenBudget.service');
const {
  DEFAULT_PROVIDER,
  getProviderSpec,
  spaceForProvider,
  resolveProviderChain,
  padVector,
} = require('../config/embedding');
const {
  RAG_RERANK_ENABLED,
  RAG_RERANK_MODEL,
  RAG_RERANK_TIMEOUT_MS,
  RAG_RERANK_MIN_RELEVANCE,
} = require('../config/chatRuntime.config');
const { rerankDocuments, isCohereRateLimited } = require('./ai/cohere.service');
const RAG_HYBRID_THRESHOLD = 0.52;
const RAG_RRF_K = 60;

const tokenizeForRanking = (text) => {
  return String(text || '')
    .toLowerCase()
    .match(/[a-z0-9]+(?:[._-][a-z0-9]+)*/g) || [];
};

const normalizeCosine = (cosine) => {
  const n = Number(cosine || 0);
  return Math.max(0, Math.min(1, (n + 1) / 2));
};

const extractNumericTokens = (text) => {
  return (String(text || '').match(/\b\d+(?:\.\d+)?\b/g) || []).map((n) => n.trim());
};

const jaccardScore = (queryTokens, docTokens) => {
  const qSet = new Set(queryTokens);
  const dSet = new Set(docTokens);
  if (!qSet.size || !dSet.size) return 0;
  let intersection = 0;
  for (const t of qSet) if (dSet.has(t)) intersection++;
  const union = qSet.size + dSet.size - intersection;
  return union > 0 ? intersection / union : 0;
};

const bm25Score = (queryTokens, docTokens, docsTokens, avgDocLen, k1 = 1.2, b = 0.75) => {
  if (!queryTokens.length || !docTokens.length || !docsTokens.length) return 0;
  const tf = new Map();
  for (const t of docTokens) tf.set(t, (tf.get(t) || 0) + 1);
  const N = docsTokens.length;
  const uniqueQ = [...new Set(queryTokens)];
  let score = 0;
  for (const term of uniqueQ) {
    let df = 0;
    for (const dTok of docsTokens) {
      if (dTok.includes(term)) df++;
    }
    if (df === 0) continue;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    const termFreq = tf.get(term) || 0;
    if (!termFreq) continue;
    const denom = termFreq + k1 * (1 - b + b * (docTokens.length / Math.max(1, avgDocLen)));
    score += idf * ((termFreq * (k1 + 1)) / denom);
  }
  return score;
};

const buildRankMapFromScores = (scores) => scores
  .map((score, idx) => ({ idx, score: Number(score) || 0 }))
  .sort((a, b) => b.score - a.score || a.idx - b.idx)
  .reduce((rankMap, item, rank) => {
    rankMap.set(item.idx, rank + 1);
    return rankMap;
  }, new Map());

const reciprocalRankFusionScore = (rankMaps, idx, k = RAG_RRF_K) => {
  return rankMaps.reduce((sum, rankMap) => {
    const rank = rankMap.get(idx);
    return sum + (rank ? 1 / (k + rank) : 0);
  }, 0);
};

const rerankDocsHybrid = (rows, queryText, topK, cosineThreshold) => {
  if (!rows?.length) return [];

  const qTokens = tokenizeForRanking(queryText);
  const qNums = extractNumericTokens(queryText);
  const docsTokens = rows.map((r) => tokenizeForRanking(r.content));
  const avgLen = docsTokens.reduce((s, d) => s + d.length, 0) / Math.max(1, docsTokens.length);

  const bm25Raw = rows.map((r, i) => bm25Score(qTokens, docsTokens[i], docsTokens, avgLen));
  const bm25Max = Math.max(1e-9, ...bm25Raw);
  const cosineNorms = rows.map((row) => normalizeCosine(row.similarity));
  const jaccardScores = rows.map((_, idx) => jaccardScore(qTokens, docsTokens[idx]));
  const bm25Norms = bm25Raw.map((score) => score / bm25Max);
  const rankMaps = [
    buildRankMapFromScores(cosineNorms),
    buildRankMapFromScores(bm25Raw),
    buildRankMapFromScores(jaccardScores),
  ];
  const rrfRaw = rows.map((_, idx) => reciprocalRankFusionScore(rankMaps, idx));
  const rrfMax = Math.max(1e-9, ...rrfRaw);

  const scored = rows.map((row, idx) => {
    const cosineNorm = cosineNorms[idx];
    const jaccard = jaccardScores[idx];
    const bm25Norm = bm25Norms[idx];
    const rrfScore = rrfRaw[idx] / rrfMax;
    const contentNums = new Set(extractNumericTokens(row.content));
    const hasAllNums = qNums.every((n) => contentNums.has(n));
    const numericBoost = qNums.length > 0 && hasAllNums ? 0.1 : 0;
    const lexicalOverlap = qTokens.length ? qTokens.filter((t) => docsTokens[idx].includes(t)).length / qTokens.length : 0;
    const hybridScore = (0.5 * cosineNorm) + (0.25 * bm25Norm) + (0.15 * jaccard) + (0.1 * rrfScore) + numericBoost;
    const numericCriticalMiss = qNums.length > 0 && !hasAllNums && cosineNorm < 0.95;
    const minAccepted = Math.max(RAG_HYBRID_THRESHOLD, normalizeCosine(cosineThreshold));
    const lexicalGate = qTokens.length === 0 || lexicalOverlap >= 0.1 || cosineNorm >= 0.85;
    const accepted = !numericCriticalMiss && hybridScore >= minAccepted && lexicalGate;
    return { ...row, bm25Score: bm25Norm, jaccardScore: jaccard, rrfScore, lexicalOverlap, hybridScore, accepted };
  });

  return scored
    .filter((r) => r.accepted)
    .sort((a, b) => b.hybridScore - a.hybridScore)
    .slice(0, topK);
};

const throwIfAborted = (signal) => {
  if (signal?.aborted) throw { name: 'AbortError' };
};

const cancelableDelay = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject({ name: 'AbortError' });
    return;
  }

  const onAbort = () => {
    clearTimeout(timer);
    reject({ name: 'AbortError' });
  };
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, ms);

  signal?.addEventListener('abort', onAbort, { once: true });
});
// ========== EMBEDDING CACHE (LRU with Hard Cap) ==========
// - Key includes userId to prevent cross-user cache sharing.
// - MAX_CACHE_SIZE prevents unbounded memory growth (memory leak fix).
// - When full, least recently used 5% of entries are evicted (true LRU).
// - Periodic background cleanup runs every 15 minutes for stale TTL entries.
const MAX_CACHE_SIZE = 5000;
const embeddingCache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hour TTL

/** Evict least recently used entries to bring cache back under MAX_CACHE_SIZE */
const enforceMaxCacheSize = () => {
  if (embeddingCache.size <= MAX_CACHE_SIZE) return;

  // Convert to array, sort by lastAccessed (ascending) + hits (ascending tiebreaker)
  const entries = [...embeddingCache.entries()]
    .sort((a, b) => {
      const la = (a[1].lastAccessed || 0) - (b[1].lastAccessed || 0);
      if (la !== 0) return la;
      return (a[1].hits || 0) - (b[1].hits || 0); // prefer keeping high-hit entries
    });

  // Evict exactly what's needed to get back under the cap (preserve as much context as possible)
  const excess = embeddingCache.size - MAX_CACHE_SIZE;
  // Evict at least 50 at a time (batch efficiency), but never more than the excess
  const deleteCount = Math.max(50, excess);
  for (let i = 0; i < deleteCount && i < entries.length; i++) {
    embeddingCache.delete(entries[i][0]);
  }
  if (deleteCount > 0) {
    console.log(`[RAG] LRU eviction: removed ${deleteCount} entries (${embeddingCache.size} remain)`);
  }
};

/** Periodic background cleanup: clear stale TTL entries so they don't accumulate */
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  let deleted = 0;
  for (const [key, value] of embeddingCache) {
    if (now - value.timestamp > CACHE_TTL) {
      embeddingCache.delete(key);
      deleted++;
    }
  }
  if (deleted > 0) {
    console.log(`[RAG] Cache cleanup: removed ${deleted} stale entries (${embeddingCache.size} remain)`);
  }
}, 15 * 60 * 1000);
const cleanupTimerAny = /** @type {any} */ (cleanupTimer);
if (cleanupTimerAny && typeof cleanupTimerAny.unref === 'function') {
  cleanupTimerAny.unref(); // avoid keeping Node alive in long-running servers
}

// Keyed by embedding SPACE rather than provider, so an openrouter and an
// openai request for the same text share one entry — they are the same model.
const getCacheKey = (text, space, userId = null) => {
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  return `${userId || 'anon'}:${space}:${hash}`;
};

const getCachedEmbedding = (key) => {
  const cached = embeddingCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    embeddingCache.delete(key);
    return null;
  }
  // Track LRU access and hit count — used by eviction to keep hot entries
  cached.lastAccessed = Date.now();
  cached.hits = (cached.hits || 0) + 1;
  return cached.vector;
};

const setCachedEmbedding = (key, vector) => {
  embeddingCache.set(key, {
    vector,
    timestamp: Date.now(),
    lastAccessed: Date.now(),
    hits: 0,
  });
  enforceMaxCacheSize();
};

const clearEmbeddingCache = () => {
  embeddingCache.clear();
};

const isMaxContextError = (message = '') => /maximum context length|context length|too many tokens|invalid 'input'/i.test(String(message));
/** Reject the outstanding promise as soon as the caller aborts. */
const raceAbort = (promise, signal) => {
  if (!signal) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      if (signal.aborted) {
        reject({ name: 'AbortError' });
        return;
      }
      signal.addEventListener('abort', () => reject({ name: 'AbortError' }), { once: true });
    }),
  ]);
};

/**
 * Normalize a provider error before it reaches the failover loop.
 * Cancellation and over-length input pass through untouched: neither is worth
 * retrying, and callers key off EMBED_INPUT_TOO_LONG to split the text.
 * @returns {never}
 */
const rethrowAsEmbeddingError = (err) => {
  if (err?.name === 'AbortError' || err?.name === 'CanceledError') throw err;
  if (err?.code === 'EMBED_INPUT_TOO_LONG') throw err;

  const apiError = err?.response?.data?.error;
  if (apiError) {
    const details = typeof apiError === 'string' ? apiError : JSON.stringify(apiError);
    if (isMaxContextError(details)) {
      throw Object.assign(new Error('Embedding input exceeds provider context limit'), { code: 'EMBED_INPUT_TOO_LONG' });
    }
    // Keep .response so the rate-limit check downstream can still see the status.
    throw Object.assign(new Error(details), { response: err.response });
  }
  throw err;
};

const isRetriableRateLimit = (err) => {
  const status = err?.response?.status || err?.status;
  if (status === 429) return true;
  return /\b429\b|rate.?limit/i.test(String(err?.message || ''));
};

/**
 * One entry per provider. Each resolves { vector, tokensUsed } with the vector
 * at its NATIVE width, or throws. Padding, caching and failover are the chain's
 * job in embedText, not each provider's.
 */
const providerCalls = {
  async openrouter(text, { signal, estimatedTokens }) {
    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/embeddings',
        { model: getProviderSpec('openrouter').model, input: text },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:3000',
            'X-Title': 'MultiAI Chat',
          },
          timeout: 30000,
          signal,
        }
      );

      // OpenRouter has shipped more than one response shape for this endpoint.
      const payload = response?.data;
      const vector = payload?.data?.[0]?.embedding
        || payload?.embeddings?.[0]?.embedding
        || payload?.embeddings?.[0]
        || null;

      if (!Array.isArray(vector) || vector.length === 0) {
        const payloadError = payload?.error
          ? (typeof payload.error === 'string' ? payload.error : JSON.stringify(payload.error))
          : null;
        if (payloadError && isMaxContextError(payloadError)) {
          throw Object.assign(new Error('Embedding input exceeds provider context limit'), { code: 'EMBED_INPUT_TOO_LONG' });
        }
        const keys = payload && typeof payload === 'object' ? Object.keys(payload).join(',') : typeof payload;
        throw new Error(payloadError || 'invalid payload shape (keys=' + (keys || 'none') + ')');
      }

      return { vector, tokensUsed: payload?.usage?.prompt_tokens || estimatedTokens };
    } catch (err) {
      rethrowAsEmbeddingError(err);
    }
  },

  async openai(text, { signal, estimatedTokens }) {
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/embeddings',
        { input: text, model: getProviderSpec('openai').model },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          timeout: 30000,
          signal,
        }
      );
      return {
        vector: response?.data?.data?.[0]?.embedding,
        tokensUsed: response?.data?.usage?.prompt_tokens || estimatedTokens,
      };
    } catch (err) {
      rethrowAsEmbeddingError(err);
    }
  },

  async gemini(text, { signal, estimatedTokens }) {
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: getProviderSpec('gemini').model });
      const result = await raceAbort(model.embedContent(text), signal);
      return {
        vector: result?.embedding?.values,
        tokensUsed: result?.response?.usageMetadata?.totalTokenCount || estimatedTokens,
      };
    } catch (err) {
      rethrowAsEmbeddingError(err);
    }
  },

  async mistral(text, { signal, estimatedTokens }) {
    try {
      const { embedWithMistral } = require('./ai/mistral.service');
      const result = await raceAbort(embedWithMistral(text, process.env.MISTRAL_API_KEY), signal);
      return { vector: result?.vector, tokensUsed: result?.tokensUsed || estimatedTokens };
    } catch (err) {
      rethrowAsEmbeddingError(err);
    }
  },
};

/**
 * embedText - embed `text`, failing over within the requested embedding space.
 *
 * Returns the SPACE and the provider that actually served the call. Callers
 * that persist the vector must store `space` alongside it and filter on it at
 * search time; a vector scored against a different space produces silent
 * nonsense rather than an error. See backend/config/embedding.js.
 *
 * Failover never crosses a space boundary, so a fallback result is always
 * comparable to rows already indexed under the requested space.
 *
 * @param {string} text
 * @param {string} provider 'openrouter' | 'openai' | 'gemini' | 'mistral'
 * @param {number} retries  per-provider retries, 429 only
 * @param {AbortSignal} signal
 * @param {string|null} userId - for cache isolation across users
 * @returns {Promise<Object|null>} { vector, tokensUsed, provider, space } or null
 */
const embedText = async (text, provider = DEFAULT_PROVIDER, retries = 3, signal = null, userId = null) => {
  throwIfAborted(signal);

  // Embedding models (text-embedding-3-small, etc.) have an 8,192 token limit.
  // Bound embedding input safely to 6,000 tokens to prevent provider crashes,
  // runaway embedding billing on 100k raw logs, and stay within Supabase 500MB free-tier limits.
  const rawText = String(text || '').trim();
  if (!rawText) return null;
  const safeText = estimateTokens(rawText) > 6000 ? trimTextByTokens(rawText, 6000) : rawText;
  const estimatedTokens = estimateTokens(safeText);
  const space = spaceForProvider(provider);

  // Keyed by space, not provider: an openai vector is a legitimate cache hit
  // for an openrouter request because both are text-embedding-3-small.
  const cacheKey = getCacheKey(safeText, space, userId);
  const cachedVector = getCachedEmbedding(cacheKey);
  if (cachedVector) {
    return { vector: cachedVector, tokensUsed: 0, provider, space };
  }

  const chain = resolveProviderChain(provider);
  if (chain.length === 0) {
    console.error('[RAG] No API key configured for any provider in embedding space "' + space + '".');
    return null;
  }

  let lastError = null;

  for (const candidate of chain) {
    let attemptsLeft = Math.max(0, retries);

    for (;;) {
      throwIfAborted(signal);
      try {
        const result = await providerCalls[candidate](safeText, { signal, estimatedTokens });
        const vector = result?.vector;
        if (!Array.isArray(vector) || vector.length === 0) {
          throw new Error('provider returned an empty vector');
        }

        const padded = padVector(vector);
        setCachedEmbedding(cacheKey, padded);
        if (candidate !== provider) {
          console.warn('[RAG] "' + provider + '" unavailable; served by same-space fallback "' + candidate + '".');
        }
        return { vector: padded, tokensUsed: result.tokensUsed || 0, provider: candidate, space };
      } catch (err) {
        // The caller asked to stop, or the input is too long for every provider
        // in this space. Neither is a failover case.
        if (err?.name === 'AbortError' || err?.name === 'CanceledError') throw err;
        if (err?.code === 'EMBED_INPUT_TOO_LONG') throw err;

        lastError = err;

        if (isRetriableRateLimit(err) && attemptsLeft > 0) {
          const delay = (Math.max(1, retries) - attemptsLeft + 1) * 2000; // 2s, 4s, 6s
          console.warn('[RAG] "' + candidate + '" rate limited. Retrying in ' + delay + 'ms (' + attemptsLeft + ' left)');
          await cancelableDelay(delay, signal);
          attemptsLeft--;
          continue;
        }

        console.error('[RAG] Embedding via "' + candidate + '" failed: ' + err.message);
        break; // fall through to the next provider in the same space
      }
    }
  }

  console.error('[RAG] Every provider in space "' + space + '" failed. Last error: ' + (lastError?.message || 'unknown'));
  return null;
};

/**
 * searchRelevantDocs — finds top-K similar documents for a query
 * @param {string} query      user's query text
 * @param {number} topK       number of docs to return (default 3)
 * @param {number} threshold  minimum similarity (default 0.4)
 * @param {string} provider   embedding provider ('openai'|'gemini')
 * @param {AbortSignal} signal
 * @param {string|null} userId   - REQUIRED for isolation (prevents cross-user leakage)
 * @param {string|null} topicId  - if provided, scopes search to a specific topic
 * @returns {Promise<Array>}  [{title, content, similarity}]
 */
const searchRelevantDocs = async (query, topK = 3, threshold = 0.4, provider = 'openrouter', signal = null, userId = null, topicId = null) => {
  // SAFETY GUARD: require at least userId to prevent global data leakage
  // match_documents has NO user/topic filter — without this guard it returns ALL business RAG data
  if (!userId) {
    console.warn('[RAG] searchRelevantDocs called without userId — returning empty to prevent cross-user data leakage');
    return [];
  }

  const embedResult = await embedText(query, provider, 3, signal, userId);
  if (!embedResult) return [];
  const { vector: embedding, tokensUsed: embedTokens } = embedResult;

  // Filter on the space the query vector ACTUALLY came from, not the one that
  // was requested — failover may have served this from a sibling provider.
  const embedSpace = embedResult.space;

  // Use topic-scoped search whenever possible for best isolation
  let rpcCall;
  if (topicId) {
    rpcCall = supabase.rpc('match_topic_files', {
      query_embedding: embedding,
      p_topic_id: topicId,
      match_threshold: Math.max(0.2, threshold - 0.2),
      match_count: Math.max(topK * 4, topK),
      space_param: embedSpace,
    });
  } else {
    rpcCall = supabase.rpc('match_documents', {
      query_embedding: embedding,
      provider_param: provider,
      match_threshold: Math.max(0.2, threshold - 0.2),
      match_count: Math.max(topK * 4, topK),
      space_param: embedSpace,
    });
  }

  // Race the Supabase RPC call against the abort signal
  const { data, error } = await Promise.race([
    rpcCall,
    new Promise((_, reject) => {
      if (signal?.aborted) reject({ name: 'AbortError' });
      signal?.addEventListener('abort', () => reject({ name: 'AbortError' }), { once: true });
    })
  ]);

  if (error && error.name !== 'AbortError' && error.name !== 'CanceledError') {
    console.error('[RAG] Search error:', error.message);
    return [];
  }

  if (RAG_RERANK_ENABLED && process.env.COHERE_API_KEY && data?.length > 1) {
    if (isCohereRateLimited()) {
      console.warn('[RAG] Cohere in 429 rate limit cooldown; continuing with hybrid ordering.');
    } else {
      try {
        const candidates = data.slice(0, 25);
        const { results: rerankResults, rateLimited } = await rerankDocuments(
          query,
          candidates.map((d) => d.content || ''),
          process.env.COHERE_API_KEY,
          { model: RAG_RERANK_MODEL, signal, timeout: RAG_RERANK_TIMEOUT_MS }
        );

        if (rateLimited) {
          console.warn('[RAG] Cohere 429 rate limit hit; falling back to hybrid ordering.');
        } else if (rerankResults && rerankResults.length > 0) {
          const reranked = rerankResults.map(({ index, relevanceScore }) => ({
            ...candidates[index],
            rerankScore: relevanceScore,
            hybridScore: relevanceScore,
          }));
          const relevant = reranked.filter((d) => d.rerankScore >= RAG_RERANK_MIN_RELEVANCE);
          return (relevant.length > 0 ? relevant : reranked).slice(0, topK);
        }
      } catch (rErr) {
        if (rErr?.name === 'AbortError' || rErr?.name === 'CanceledError') throw rErr;
        console.warn('[RAG] Cohere rerank unavailable in searchRelevantDocs (falling back to hybrid):', rErr.message);
      }
    }
  }

  return rerankDocsHybrid(data || [], query, topK, threshold);
};

/**
 * buildRAGContext — creates a context block from retrieved docs
 * Returns empty string if no relevant docs found
 * @param {string} query
 * @param {string} provider
 * @param {AbortSignal} signal
 * @param {Array} precomputedEmbedding
 * @param {Object} options - { tokenBudget, topicId, userId, embeddingSpace }
 *
 * `embeddingSpace` MUST accompany `precomputedEmbedding` — it names the model
 * that produced the vector, and every RPC below filters stored rows on it.
 * Without it, a caller that embedded with one model would score its vector
 * against rows indexed by another and get plausible-looking nonsense.
 */
const buildRAGContext = async (query, provider = DEFAULT_PROVIDER, signal = null, precomputedEmbedding = null, options = {}) => {
  const topicId = options.topicId;
  const userId = options.userId;
  let embedding;
  let embedTokens = 0;
  // Previously this hardcoded 'openrouter' while passing the caller's
  // `provider` to the RPCs, so the two could disagree. Both now derive from
  // the same value.
  let embedSpace = options.embeddingSpace || spaceForProvider(provider);
  if (precomputedEmbedding) {
    embedding = precomputedEmbedding;
  } else {
    const result = await embedText(query, provider, 3, signal, userId);
    if (!result) return '';
    embedding = result.vector;
    embedTokens = result.tokensUsed;
    embedSpace = result.space;
  }

  // Race the Supabase RPC call against the abort signal
  // If topicId provided, search only that topic's files (uploaded_files_rag)
  // Otherwise, return empty — no global RAG leakage across chats
  if (!topicId) return '';
  const rpcCall = supabase.rpc('match_topic_files', {
      query_embedding: embedding,
      p_topic_id: topicId,
      match_threshold: 0.2,
      match_count: 12,
      space_param: embedSpace,
    });

  const { data: docs, error } = await Promise.race([
    rpcCall,
    new Promise((_, reject) => {
      if (signal?.aborted) reject({ name: 'AbortError' });
      signal?.addEventListener('abort', () => reject({ name: 'AbortError' }), { once: true });
    })
  ]);

  if ((error && error.name !== 'AbortError' && error.name !== 'CanceledError') || !docs || docs.length === 0) return '';
  const topDocs = rerankDocsHybrid(docs, query, 3, 0.4);
  if (!topDocs.length) return '';

  // ── Chunk-level enhancement: also search rag_chunks for granular matches ──
  let allDocs = [...topDocs];
  if (topicId && userId && embedding) {
    try {
      const { data: chunkResults } = await supabase.rpc('search_uploaded_files', {
        query_embedding: embedding,
        user_id_param: userId,
        provider_param: provider,
        space_param: embedSpace,
        match_count: 5,
        topic_id_param: topicId,
      });

      if (chunkResults && chunkResults.length > 0) {
        const seenTitles = new Set(allDocs.map(d => d.title));
        for (const chunk of chunkResults) {
          // Avoid duplicating files already returned by match_topic_files
          if (!seenTitles.has(chunk.file_name)) {
            allDocs.push({
              id: chunk.file_id,
              title: `${chunk.file_name} (chunk ${chunk.chunk_index + 1})`,
              content: chunk.chunk_text,
              similarity: chunk.similarity,
            });
            seenTitles.add(chunk.file_name);
          }
        }
        // Re-sort by similarity
        allDocs.sort((a, b) => b.similarity - a.similarity);
        // Keep top 5
        allDocs = allDocs.slice(0, 5);
      }
    } catch (chunkErr) {
      // Non-critical: chunk search is an enhancement, fall back to file-level results
      if (chunkErr.name !== 'AbortError' && chunkErr.name !== 'CanceledError') {
        console.warn('[RAG] Chunk-level search failed, using file-level only:', chunkErr.message);
      }
    }
  }

  // Cross-encoder rerank of context docs if available (with 429 rate limit resilience)
  if (allDocs.length > 1 && RAG_RERANK_ENABLED && process.env.COHERE_API_KEY) {
    if (isCohereRateLimited()) {
      console.warn('[RAG] Cohere in 429 rate limit cooldown; continuing with un-reranked context docs.');
    } else {
      try {
        const { results: rerankResults, rateLimited } = await rerankDocuments(
          query,
          allDocs.map((d) => d.content || ''),
          process.env.COHERE_API_KEY,
          { model: RAG_RERANK_MODEL, signal, timeout: RAG_RERANK_TIMEOUT_MS }
        );

        if (rateLimited) {
          console.warn('[RAG] Cohere 429 rate limit hit during rerank; continuing without rerank input.');
        } else if (rerankResults && rerankResults.length > 0) {
          const rerankedDocs = rerankResults.map(({ index, relevanceScore }) => ({
            ...allDocs[index],
            rerankScore: relevanceScore,
          }));
          const relevant = rerankedDocs.filter((d) => d.rerankScore >= RAG_RERANK_MIN_RELEVANCE);
          allDocs = (relevant.length > 0 ? relevant : rerankedDocs).slice(0, 5);
          console.log(`[RAG] Reranked ${rerankResults.length} context docs via ${RAG_RERANK_MODEL} (top score: ${allDocs[0]?.rerankScore?.toFixed(3)})`);
        }
      } catch (rErr) {
        if (rErr?.name === 'AbortError' || rErr?.name === 'CanceledError') throw rErr;
        console.warn('[RAG] Cohere rerank unavailable in buildRAGContext (continuing with similarity order):', rErr.message);
      }
    }
  }

  const totalTokenBudget = options.tokenBudget || 650;
  const perDocBudget = Math.max(120, Math.floor(totalTokenBudget / allDocs.length));
  const contextBlock = allDocs
    .map((d, i) => `[Document ${i + 1}: ${d.title}]\n${trimTextByTokens(d.content, perDocBudget)}`)
    .join('\n\n');

  return `[KNOWLEDGE BASE CONTEXT]\n${contextBlock}\n[END KNOWLEDGE BASE]\n\nUse the above context if relevant to answer the question.`;
};

module.exports = { buildRAGContext, embedText, searchRelevantDocs, clearEmbeddingCache, rerankDocsHybrid };
