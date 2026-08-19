// ============================================================
// FILE: backend/services/ai/groq.service.js
// PURPOSE: Calls Groq API (OpenAI-compatible interface)
// ============================================================

const Groq = require('groq-sdk');
const { resolveReasoning } = require('./reasoning.service');

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
const callGroqStream = async (modelName, apiKey, messages, signal = null, onChunk, onReasoning, modelConfig = null, reasoningRequest = {}) => {
  const client = new Groq({ apiKey });
  // Groq has no "disabled" value — thinking is turned off by leaving
  // reasoning_effort out of the request entirely.
  const decision = resolveReasoning(modelConfig, reasoningRequest);
  const stream = await client.chat.completions.create({
    model:       modelName,
    messages:    messages.map(m => ({ role: m.role, content: m.content })),
    max_tokens:  4000,
    temperature: 0.7,
    stream:      true,
    ...(decision.enabled && decision.effort ? { reasoning_effort: decision.effort } : {}),
  }, { signal });

  let fullText = '';
  let fullReasoning = '';
  let tokensUsed = 0;

  for await (const chunk of stream) {
    const reasoningDelta = chunk.choices?.[0]?.delta?.reasoning
      || chunk.choices?.[0]?.delta?.reasoning_content;
    if (reasoningDelta) {
      fullReasoning += reasoningDelta;
      if (onReasoning) onReasoning(reasoningDelta);
    }
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      fullText += delta;
      if (onChunk) onChunk(delta);
    }
    if (chunk.usage?.total_tokens) {
      tokensUsed = chunk.usage.total_tokens;
    }
  }

  return { text: fullText, reasoning: fullReasoning, tokensUsed };
};

module.exports = { callGroq, callGroqStream };
