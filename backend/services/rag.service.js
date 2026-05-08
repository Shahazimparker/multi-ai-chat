// ============================================================
// FILE: backend/services/rag.service.js
// PURPOSE: Retrieval-Augmented Generation using pgvector
//          Embeds queries with OpenAI, searches similar docs,
//          injects relevant context into AI prompt
// ============================================================

const axios = require('axios');
const supabase = require('../config/supabase');

/**
 * embedText — creates 512-dim vector embedding using OpenAI text-embedding-3-small
 */
const embedText = async (text) => {
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
      }
    );
    return response.data.data[0].embedding;
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
