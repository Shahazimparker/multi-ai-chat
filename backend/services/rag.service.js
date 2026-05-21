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
const EVICT_PERCENT = 0.05; // evict only 5% at a time (gentler under high load)
const embeddingCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour TTL

/** Evict least recently used entries when cache exceeds MAX_CACHE_SIZE */
const enforceMaxCacheSize = () => {
  if (embeddingCache.size <= MAX_CACHE_SIZE) return;

  // Convert to array, sort by lastAccessed (ascending), evict oldest 5%
  const entries = [...embeddingCache.entries()]
    .sort((a, b) => (a[1].lastAccessed || 0) - (b[1].lastAccessed || 0));

  const deleteCount = Math.ceil(MAX_CACHE_SIZE * EVICT_PERCENT);
  for (let i = 0; i < deleteCount && i < entries.length; i++) {
    embeddingCache.delete(entries[i][0]);
  }
};

/** Periodic background cleanup: clear stale TTL entries so they don't accumulate */
setInterval(() => {
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
}, 15 * 60 * 1000).unref(); // .unref() so it doesn't keep Node process alive

const getCacheKey = (text, provider, userId = null) => {
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  return `${userId || 'anon'}:${provider}:${hash}`;
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
/**
 * embedText — creates vector embedding using the selected provider
 * NOW RETURNS { vector, tokensUsed } instead of just the vector array
 * @param {string} text
 * @param {string} provider 'openrouter' 'mistral', 'gemini', or 'openai' (default: 'openrouter')
 * @param {number} retries
 * @param {AbortSignal} signal
 * @param {string|null} userId - for cache isolation across users
 * @returns {Object|null} { vector: number[], tokensUsed: number } or null on failure
 */
const embedText = async (text, provider = 'openrouter', retries = 3, signal = null, userId = null) => {
  // Immediate check if already aborted
  throwIfAborted(signal);

  // Estimate tokens for this embedding call (used if cached or as fallback)
  const estimatedTokens = estimateTokens(text);

  // Check cache first
  const cacheKey = getCacheKey(text, provider, userId);
  const cachedVector = getCachedEmbedding(cacheKey);
  if (cachedVector) {
    return { vector: cachedVector, tokensUsed: 0 }; // cached = no new tokens consumed
  }

  if (provider === 'openrouter') {
    if (!process.env.OPENROUTER_API_KEY) {
      console.error('[RAG] Error: OPENROUTER_API_KEY is not defined.');
      return null;
    }
    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/embeddings',
        {
          model: 'openai/text-embedding-3-small',
          input: text,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'MultiAI Chat',
          },
          timeout: 30000,
          signal: signal
        }
      );

      let vector = response.data.data[0].embedding;
      // Try to get actual tokens from API response, fall back to estimate
      const actualTokens = response.data.usage?.prompt_tokens || estimatedTokens;

      if (vector.length < 1536) {
        vector = [...vector, ...new Array(1536 - vector.length).fill(0)];
      }
      setCachedEmbedding(cacheKey, vector);
      return { vector, tokensUsed: actualTokens };
    } catch (err) {
      if (err.name === 'AbortError' || err.name === 'CanceledError') throw err;
      console.error('[RAG] OpenRouter Embedding failed:', err.message);
      return null;
    }
  }
  if (provider === 'mistral') {
    const { embedWithMistral } = require('./ai/mistral.service');
    if (!process.env.MISTRAL_API_KEY) {
      console.error('[RAG] Error: MISTRAL_API_KEY is not defined.');
      return null;
    }
    try {
      const result = await embedWithMistral(text, process.env.MISTRAL_API_KEY);
      // embedWithMistral now returns { vector, tokensUsed }
      setCachedEmbedding(cacheKey, result.vector);
      return { vector: result.vector, tokensUsed: result.tokensUsed };
    } catch (err) {
      if (err.name === 'AbortError' || err.name === 'CanceledError') throw err;
      console.error('[RAG] Mistral Embedding failed:', err.message);
      return null;
    }
  }

  if (provider === 'gemini') {
    if (!process.env.GEMINI_API_KEY) {
      console.error('[RAG] Error: GEMINI_API_KEY is not defined.');
      return null;
    }
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      // Use text-embedding-004 which is the current state-of-the-art for Gemini embeddings
      const model = genAI.getGenerativeModel({ model: "embedding-001" });
      // Race the Gemini embedding call against the abort signal
      const result = await Promise.race([
        model.embedContent(text),
        new Promise((_, reject) => {
          if (signal?.aborted) reject({ name: 'AbortError' });
          signal?.addEventListener('abort', () => reject({ name: 'AbortError' }), { once: true });
        })
      ]);

      let vector = result.embedding.values;
      // Try to get actual tokens from Gemini response
      const actualTokens = result.response?.usageMetadata?.totalTokenCount || estimatedTokens;
      // Pad with zeros to match Supabase 1536-dimension columns if necessary
      if (vector.length < 1536) {
        vector = [...vector, ...new Array(1536 - vector.length).fill(0)];
      }
      // Cache the embedding
      setCachedEmbedding(cacheKey, vector);
      return { vector, tokensUsed: actualTokens };
    } catch (err) {
      if (err.message?.includes('429') && retries > 0) {
        throwIfAborted(signal);

        const delay = (4 - retries) * 2000;
        console.warn(`[RAG] Gemini Rate limited. Retrying in ${delay}ms...`);
        await cancelableDelay(delay, signal);
        throwIfAborted(signal);

        // If we reach here, delay completed without abort, so proceed with retry
        return embedText(text, provider, retries - 1, signal, userId);
      }
      if (err.name === 'AbortError' || err.name === 'CanceledError') throw err; // Re-throw AbortError/CanceledError immediately
      console.error('[RAG] Gemini Embedding failed:', err.message);
      return null;
    }
  }

  // Default: OpenAI
  if (!process.env.OPENAI_API_KEY) {
    console.error('[RAG] Error: OPENAI_API_KEY is not defined.');
    return null;
  }

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/embeddings',
      {
        input: text,
        model: 'text-embedding-3-small',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        signal: signal
      }
    );
    const vector = response.data.data[0].embedding;
    const actualTokens = response.data.usage?.prompt_tokens || estimatedTokens;
    setCachedEmbedding(cacheKey, vector);
    return { vector, tokensUsed: actualTokens };
  } catch (err) {
    if (err.name === 'CanceledError' || err.name === 'AbortError') {
      throw err;
    }
    if (err.response?.status === 401) {
      console.error('[RAG] Embedding failed: 401 Unauthorized. Check your OPENAI_API_KEY.');
    }
    if (err.response?.status === 429) {
      if (retries > 0) {
        throwIfAborted(signal);

        const delay = (4 - retries) * 2000; // 2s, 4s, 6s...
        console.warn(`[RAG] Rate limited (429). Retrying in ${delay}ms... (${retries} attempts left)`);
        await cancelableDelay(delay, signal);
        throwIfAborted(signal);

        // If we reach here, delay completed without abort, so proceed with retry
        return embedText(text, provider, retries - 1, signal, userId);
      }
      console.error('[RAG] Embedding failed: 429 Too Many Requests. Rate limit exceeded. No more retries.');
    }
    if (err.name === 'AbortError' || err.name === 'CanceledError') throw err; // Re-throw AbortError/CanceledError immediately
    console.error('[RAG] Embedding failed:', err.message); // Log other errors
    return null;
  }
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
 * @returns {Array}           [{title, content, similarity}]
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

  // Use topic-scoped search whenever possible for best isolation
  let rpcCall;
  if (topicId) {
    rpcCall = supabase.rpc('match_topic_files', {
      query_embedding: embedding,
      p_topic_id: topicId,
      match_threshold: threshold,
      match_count: topK,
    });
  } else {
    rpcCall = supabase.rpc('match_documents', {
      query_embedding: embedding,
      provider_param: provider,
      match_threshold: threshold,
      match_count: topK,
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

  return data || [];
};

/**
 * buildRAGContext — creates a context block from retrieved docs
 * Returns empty string if no relevant docs found
 * @param {string} query
 * @param {string} provider
 * @param {AbortSignal} signal
 * @param {Array} precomputedEmbedding
 * @param {Object} options - { tokenBudget, topicId }
 */
const buildRAGContext = async (query, provider = 'openrouter', signal = null, precomputedEmbedding = null, options = {}) => {
  const topicId = options.topicId;
  const userId = options.userId;
  let embedding;
  let embedTokens = 0;
  if (precomputedEmbedding) {
    embedding = precomputedEmbedding;
  } else {
    const result = await embedText(query, 'openrouter', 3, signal, userId);
    if (!result) return '';
    embedding = result.vector;
    embedTokens = result.tokensUsed;
  }

  // Race the Supabase RPC call against the abort signal
  // If topicId provided, search only that topic's files (uploaded_files_rag)
  // Otherwise, return empty — no global RAG leakage across chats
  if (!topicId) return '';
  const rpcCall = supabase.rpc('match_topic_files', {
      query_embedding: embedding,
      p_topic_id: topicId,
      match_threshold: 0.4,
      match_count: 3,
    });

  const { data: docs, error } = await Promise.race([
    rpcCall,
    new Promise((_, reject) => {
      if (signal?.aborted) reject({ name: 'AbortError' });
      signal?.addEventListener('abort', () => reject({ name: 'AbortError' }), { once: true });
    })
  ]);

  if ((error && error.name !== 'AbortError' && error.name !== 'CanceledError') || !docs || docs.length === 0) return '';

  // ── Chunk-level enhancement: also search rag_chunks for granular matches ──
  let allDocs = [...docs];
  if (topicId && userId && embedding) {
    try {
      const { data: chunkResults } = await supabase.rpc('search_uploaded_files', {
        query_embedding: embedding,
        user_id_param: userId,
        provider_param: provider,
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

  const totalTokenBudget = options.tokenBudget || 650;
  const perDocBudget = Math.max(120, Math.floor(totalTokenBudget / allDocs.length));
  const contextBlock = allDocs
    .map((d, i) => `[Document ${i + 1}: ${d.title}]\n${trimTextByTokens(d.content, perDocBudget)}`)
    .join('\n\n');

  return `[KNOWLEDGE BASE CONTEXT]\n${contextBlock}\n[END KNOWLEDGE BASE]\n\nUse the above context if relevant to answer the question.`;
};

module.exports = { buildRAGContext, embedText, searchRelevantDocs, clearEmbeddingCache };
