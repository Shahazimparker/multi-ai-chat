// ============================================================
// FILE: backend/services/ai/cohere.service.js
// PURPOSE: Calls Cohere API (chat endpoint)
// ============================================================

const axios = require('axios');

const COHERE_CHAT_URL = 'https://api.cohere.ai/v1/chat';

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
