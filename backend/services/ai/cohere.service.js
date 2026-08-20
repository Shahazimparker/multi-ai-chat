// ============================================================
// FILE: backend/services/ai/cohere.service.js
// PURPOSE: Calls Cohere API (chat endpoint)
// ============================================================

const axios = require('axios');

const COHERE_CHAT_URL = 'https://api.cohere.ai/v1/chat';
const COHERE_RERANK_URL = 'https://api.cohere.com/v2/rerank';

// One rerank request covers up to 1000 documents, but Cohere bills per "search
// unit" of 100. Retrieval shortlists are far below that, so a rerank costs a
// single unit; the cap here is a guard against a caller passing a whole corpus.
const RERANK_MAX_DOCUMENTS = 200;

/**
 * Shared helper to build Cohere request payload from messages array.
 */
function buildCoherePayload(modelName, messages, stream = false) {
  const systemMessages = messages.filter(m => m.role === 'system');
  const preamble = systemMessages.length > 0
    ? systemMessages.map(m => m.content).join('\n')
    : undefined;

  const nonSystemMsgs = messages.filter(m => m.role !== 'system');
  const chatHistory = nonSystemMsgs.slice(0, -1).map(m => ({
    role:    m.role === 'user' ? 'USER' : 'CHATBOT',
    message: m.content,
  }));
  const lastMessage = nonSystemMsgs[nonSystemMsgs.length - 1]?.content || '';

  return {
    model:        modelName,
    message:      lastMessage,
    chat_history: chatHistory,
    ...(preamble && { preamble_override: preamble }),
    max_tokens:   16000,
    temperature:  0.7,
    stream,
  };
}

const callCohere = async (modelName, apiKey, messages, signal = null) => {
  const payload = buildCoherePayload(modelName, messages, false);
  const response = await axios.post(COHERE_CHAT_URL, payload, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal,
  });

  const text       = response.data.text || '';
  const tokensUsed = (response.data.meta?.tokens?.input_tokens || 0) +
                     (response.data.meta?.tokens?.output_tokens || 0);
  return { text, tokensUsed };
};

/**
 * Streaming variant for Cohere — consumes SSE stream via axios.
 * @param {string} modelName
 * @param {string} apiKey
 * @param {Array} messages
 * @param {AbortSignal|null} signal
 * @param {(text: string) => void} onChunk
 * @returns {Promise<{text: string, tokensUsed: number}>}
 */
const callCohereStream = async (modelName, apiKey, messages, signal = null, onChunk) => {
  const payload = buildCoherePayload(modelName, messages, true);
  const response = await axios.post(COHERE_CHAT_URL, payload, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    signal,
    responseType: 'stream',
  });

  return new Promise((resolve, reject) => {
    let fullText = '';
    let tokensUsed = 0;
    let buffer = '';

    response.data.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const jsonStr = trimmed.slice(6);
        if (jsonStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(jsonStr);
          // Cohere stream events: 'text-generation' events have text field
          if (parsed.event_type === 'text-generation' && parsed.text) {
            fullText += parsed.text;
            if (onChunk) onChunk(parsed.text);
          }
          if (parsed.event_type === 'stream-end' && parsed.response?.meta?.tokens) {
            const meta = parsed.response.meta.tokens;
            tokensUsed = (meta.input_tokens || 0) + (meta.output_tokens || 0);
          }
        } catch { /* skip malformed */ }
      }
    });

    response.data.on('end', () => resolve({ text: fullText, tokensUsed }));
    response.data.on('error', (err) => reject(err));

    if (signal) {
      signal.addEventListener('abort', () => {
        response.data.destroy();
        reject({ name: 'AbortError' });
      }, { once: true });
    }
  });
};

/**
 * rerankDocuments - score documents against a query with a cross-encoder.
 *
 * Unlike embedding similarity, which encodes query and document separately and
 * compares the results, a cross-encoder reads the pair together and scores how
 * well that document answers that query. Far more accurate, far too slow to run
 * over a corpus — so it reranks a shortlist that vector search produced.
 *
 * Returns entries ordered best-first, each carrying the caller's original array
 * index so results can be mapped back to whatever objects they came from.
 * Throws on failure; callers are expected to fall back to their own ordering
 * rather than let a reranker outage break retrieval.
 *
 * @param {string} query
 * @param {string[]} documents plain texts, aligned to the caller's own array
 * @param {string} apiKey
 * @param {{ model?: string, topN?: number, signal?: AbortSignal, timeout?: number }} options
 * @returns {Promise<{ results: Array<{ index: number, relevanceScore: number }>, searchUnits: number }>}
 */
const rerankDocuments = async (query, documents, apiKey, options = {}) => {
  const {
    model = 'rerank-v3.5',
    topN = null,
    signal = null,
    timeout = 10000,
  } = options;

  if (!apiKey) throw new Error('Cohere API key is not configured');
  if (!query || !String(query).trim()) throw new Error('rerank requires a non-empty query');
  if (!Array.isArray(documents) || documents.length === 0) {
    return { results: [], searchUnits: 0 };
  }

  const texts = documents.slice(0, RERANK_MAX_DOCUMENTS).map((d) => String(d ?? ''));

  const payload = {
    model,
    query: String(query),
    documents: texts,
  };
  if (topN) payload.top_n = Math.min(topN, texts.length);

  const response = await axios.post(COHERE_RERANK_URL, payload, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Client-Name': 'MultiAI Chat',
    },
    timeout,
    signal,
  });

  const raw = response?.data?.results;
  if (!Array.isArray(raw)) {
    throw new Error('Cohere rerank returned no results array');
  }

  // Cohere returns results already sorted by relevance, but sort defensively so
  // callers can rely on the ordering regardless of API behaviour.
  const results = raw
    .filter((r) => Number.isInteger(r?.index) && r.index >= 0 && r.index < texts.length)
    .map((r) => ({ index: r.index, relevanceScore: Number(r.relevance_score) || 0 }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  return {
    results,
    searchUnits: response?.data?.meta?.billed_units?.search_units || 0,
  };
};

module.exports = { callCohere, callCohereStream, rerankDocuments };
