// ============================================================
// FILE: backend/services/rag.service.js
// PURPOSE: Retrieval-Augmented Generation using pgvector
//          Embeds queries with Gemini, searches similar docs,
//          injects relevant context into AI prompt
// ============================================================

const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase                = require('../config/supabase');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * embedText — creates 768-dim vector embedding using Gemini
 */
const embedText = async (text) => {
  try {
    const model  = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (err) {
    console.error('[RAG] Embedding failed:', err.message);
    return null;
  }
};

/**
 * searchRelevantDocs — finds top-K similar documents for a query
 * @param {string} query      user's query text
 * @param {number} topK       number of docs to return (default 3)
 * @param {number} threshold  minimum similarity (default 0.7)
 * @returns {Array}           [{title, content, similarity}]
 */
const searchRelevantDocs = async (query, topK = 3, threshold = 0.7) => {
  const embedding = await embedText(query);
  if (!embedding) return [];

  const { data, error } = await supabase.rpc('match_documents', {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count:     topK,
  });

  if (error) {
    console.error('[RAG] Search error:', error.message);
    return [];
  }

  return data || [];
};

/**
 * buildRAGContext — creates a context block from retrieved docs
 * Returns empty string if no relevant docs found
 */
const buildRAGContext = async (query) => {
  const docs = await searchRelevantDocs(query);
  if (docs.length === 0) return '';

  const contextBlock = docs
    .map((d, i) => `[Document ${i + 1}: ${d.title}]\n${d.content}`)
    .join('\n\n');

  return `[KNOWLEDGE BASE CONTEXT]\n${contextBlock}\n[END KNOWLEDGE BASE]\n\nUse the above context if relevant to answer the question.`;
};

module.exports = { buildRAGContext, embedText, searchRelevantDocs };
