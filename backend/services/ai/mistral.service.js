// ============================================================
// FILE: backend/services/ai/mistral.service.js
// PURPOSE: Calls Mistral AI API + Mistral Embeddings
// ============================================================

const axios = require('axios');

const MISTRAL_CHAT_URL = 'https://api.mistral.ai/v1/chat/completions';

const callMistral = async (modelName, apiKey, messages, signal = null) => {
  const response = await axios.post(
    MISTRAL_CHAT_URL,
    {
      model:       modelName,
      messages:    messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens:  16000,
      temperature: 0.7,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal,
    }
  );

  const text       = response.data.choices[0]?.message?.content || '';
  const tokensUsed = response.data.usage?.total_tokens || 0;
  return { text, tokensUsed };
};

/**
 * Streaming variant for Mistral — consumes SSE stream via axios, yields text deltas.
 * @param {string} modelName
 * @param {string} apiKey
 * @param {Array} messages
 * @param {AbortSignal|null} signal
 * @param {(text: string) => void} onChunk
 * @returns {Promise<{text: string, tokensUsed: number}>}
 */
const callMistralStream = async (modelName, apiKey, messages, signal = null, onChunk) => {
  const response = await axios.post(
    MISTRAL_CHAT_URL,
    {
      model:       modelName,
      messages:    messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens:  16000,
      temperature: 0.7,
      stream:      true,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      signal,
      responseType: 'stream',
    }
  );

  return new Promise((resolve, reject) => {
    let fullText = '';
    let tokensUsed = 0;
    let buffer = '';

    response.data.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const jsonStr = trimmed.slice(6);
        if (jsonStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            if (onChunk) onChunk(delta);
          }
          if (parsed.usage?.total_tokens) {
            tokensUsed = parsed.usage.total_tokens;
          }
        } catch { /* skip malformed lines */ }
      }
    });

    response.data.on('end', () => {
      resolve({ text: fullText, tokensUsed });
    });

    response.data.on('error', (err) => {
      reject(err);
    });

    if (signal) {
      signal.addEventListener('abort', () => {
        response.data.destroy();
        reject({ name: 'AbortError' });
      }, { once: true });
    }
  });
};

/**
 * embedWithMistral — generates embedding via Mistral API
 * NOW RETURNS { vector, tokensUsed } instead of just the vector array
 */
const embedWithMistral = async (text, apiKey) => {
  const response = await axios.post(
    'https://api.mistral.ai/v1/embeddings',
    {
      model: 'mistral-embed',
      input: [text],
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  let vector = response.data.data[0].embedding; // 1024 dims
  // Try to get actual token usage from API response
  const tokensUsed = response.data.usage?.prompt_tokens || 0;
  // Pad to 1536 to match Supabase pgvector column
  if (vector.length < 1536) {
    vector = [...vector, ...new Array(1536 - vector.length).fill(0)];
  }
  return { vector, tokensUsed };
};

module.exports = { callMistral, embedWithMistral };