// ============================================================
// FILE: backend/services/ai/groq.service.js
// PURPOSE: Calls Groq API (OpenAI-compatible interface)
// ============================================================

const Groq = require('groq-sdk');

const callGroq = async (modelName, apiKey, messages, signal = null) => {
  const client   = new Groq({ apiKey });
  const response = await client.chat.completions.create({
    model:       modelName,
    messages:    messages.map(m => ({ role: m.role, content: m.content })),
    max_tokens:  4000,
    temperature: 0.7,
  }, { signal });

  const text       = response.choices[0]?.message?.content || '';
  const tokensUsed = response.usage?.total_tokens || 0;
  return { text, tokensUsed };
};

/**
 * Streaming variant for Groq (OpenAI-compatible).
 * @param {string} modelName
 * @param {string} apiKey
 * @param {Array} messages
 * @param {AbortSignal|null} signal
 * @param {(text: string) => void} onChunk
 * @returns {Promise<{text: string, tokensUsed: number}>}
 */
const callGroqStream = async (modelName, apiKey, messages, signal = null, onChunk) => {
  const client = new Groq({ apiKey });
  const stream = await client.chat.completions.create({
    model:       modelName,
    messages:    messages.map(m => ({ role: m.role, content: m.content })),
    max_tokens:  4000,
    temperature: 0.7,
    stream:      true,
  }, { signal });

  let fullText = '';
  let tokensUsed = 0;

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      fullText += delta;
      if (onChunk) onChunk(delta);
    }
    if (chunk.usage?.total_tokens) {
      tokensUsed = chunk.usage.total_tokens;
    }
  }

  return { text: fullText, tokensUsed };
};

module.exports = { callGroq, callGroqStream };
