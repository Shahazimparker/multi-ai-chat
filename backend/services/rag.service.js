// ============================================================
// FILE: backend/services/rag.service.js
// PURPOSE: Retrieval-Augmented Generation using pgvector
//          Embeds queries with OpenAI, searches similar docs,
//          injects relevant context into AI prompt
// ============================================================

const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase = require('../config/supabase');
const { trimTextByTokens } = require('./tokenBudget.service');

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

/**
 * embedText — creates vector embedding using the selected provider
 * @param {string} text
 * @param {string} provider 'openai' or 'gemini'
 * @param {number} retries
 * @param {AbortSignal} signal
 */
const embedText = async (text, provider = 'openai', retries = 3, signal = null) => {
  // Immediate check if already aborted
  throwIfAborted(signal);

  if (provider === 'gemini') {
    if (!process.env.GEMINI_API_KEY) {
      console.error('[RAG] Error: GEMINI_API_KEY is not defined.');
      return null;
    }
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      // Use text-embedding-004 which is the current state-of-the-art for Gemini embeddings
      const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
      
      // Race the Gemini embedding call against the abort signal
      const result = await Promise.race([
        model.embedContent(text),
        new Promise((_, reject) => {
          if (signal?.aborted) reject({ name: 'AbortError' });
          signal?.addEventListener('abort', () => reject({ name: 'AbortError' }), { once: true });
        })
      ]);
      
      let vector = result.embedding.values;
      // Pad with zeros to match Supabase 1536-dimension columns if necessary
      if (vector.length < 1536) {
        vector = [...vector, ...new Array(1536 - vector.length).fill(0)];
      }
      return vector;
    } catch (err) {
      if (err.message?.includes('429') && retries > 0) {
        throwIfAborted(signal);

        const delay = (4 - retries) * 2000;
        console.warn(`[RAG] Gemini Rate limited. Retrying in ${delay}ms...`);
        await cancelableDelay(delay, signal);
        throwIfAborted(signal);

        // If we reach here, delay completed without abort, so proceed with retry
        return embedText(text, provider, retries - 1, signal);
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
    return response.data.data[0].embedding;
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
        return embedText(text, provider, retries - 1, signal);
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
 * @returns {Array}           [{title, content, similarity}]
 */
const searchRelevantDocs = async (query, topK = 3, threshold = 0.4, provider = 'openai', signal = null) => {
  const embedding = await embedText(query, provider, 3, signal);
  if (!embedding) return [];

  // Race the Supabase RPC call against the abort signal
  const { data, error } = await Promise.race([
    supabase.rpc('match_documents', {
      query_embedding: embedding,
      provider_param:  provider,
      match_threshold: threshold,
      match_count:     topK,
    }),
    new Promise((_, reject) => {
      if (signal?.aborted) reject({ name: 'AbortError' });
      signal?.addEventListener('abort', () => reject({ name: 'AbortError' }), { once: true });
    })
  ]);

  if (error && error.name !== 'AbortError' && error.name !== 'CanceledError') { // Only log if not an abort
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
 */
const buildRAGContext = async (query, provider = 'openai', signal = null, precomputedEmbedding = null, options = {}) => {
  const embedding = precomputedEmbedding || await embedText(query, provider, 3, signal);
  if (!embedding) return '';

  // Race the Supabase RPC call against the abort signal
  const { data: docs, error } = await Promise.race([
    supabase.rpc('match_documents', {
      query_embedding: embedding,
      provider_param:  provider,
      match_threshold: 0.4,
      match_count:     3,
    }),
    new Promise((_, reject) => {
      if (signal?.aborted) reject({ name: 'AbortError' });
      signal?.addEventListener('abort', () => reject({ name: 'AbortError' }), { once: true });
    })
  ]);

  if ((error && error.name !== 'AbortError' && error.name !== 'CanceledError') || !docs || docs.length === 0) return ''; // Only log if not an abort

  const totalTokenBudget = options.tokenBudget || 650;
  const perDocBudget = Math.max(120, Math.floor(totalTokenBudget / docs.length));
  const contextBlock = docs
    .map((d, i) => `[Document ${i + 1}: ${d.title}]\n${trimTextByTokens(d.content, perDocBudget)}`)
    .join('\n\n');

  return `[KNOWLEDGE BASE CONTEXT]\n${contextBlock}\n[END KNOWLEDGE BASE]\n\nUse the above context if relevant to answer the question.`;
};

module.exports = { buildRAGContext, embedText, searchRelevantDocs };
