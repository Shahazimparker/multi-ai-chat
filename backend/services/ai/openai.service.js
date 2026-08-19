// ============================================================
// FILE: backend/services/ai/openai.service.js
// PURPOSE: Calls OpenAI GPT API
// ============================================================

const OpenAI = require('openai');

const callOpenAI = async (modelName, apiKey, messages, signal = null) => {
  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model: modelName,
    max_tokens: 16000,
    messages,
  }, { signal });

  return {
    text: response.choices[0].message.content,
    tokensUsed: response.usage.prompt_tokens + response.usage.completion_tokens,
    cacheCreationTokens: response.usage.cache_creation_input_tokens || 0,
    cacheReadTokens: response.usage.cache_read_input_tokens || 0,
  };
};

/**
 * Streaming variant — yields text deltas via onChunk callback.
 * @param {string} modelName
 * @param {string} apiKey
 * @param {Array} messages
 * @param {AbortSignal|null} signal
 * @param {(text: string) => void} onChunk
 * @returns {Promise<{text: string, tokensUsed: number, cacheCreationTokens: number, cacheReadTokens: number}>}
 */
const callOpenAIStream = async (modelName, apiKey, messages, signal = null, onChunk, onReasoning) => {
  const client = new OpenAI({ apiKey });

  const stream = await client.chat.completions.create({
    model: modelName,
    max_tokens: 16000,
    messages,
    stream: true,
  }, { signal });

  let fullText = '';
  let fullReasoning = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;

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
    if (chunk.usage) {
      promptTokens = chunk.usage.prompt_tokens || 0;
      completionTokens = chunk.usage.completion_tokens || 0;
      cacheCreationTokens = chunk.usage.cache_creation_input_tokens || 0;
      cacheReadTokens = chunk.usage.cache_read_input_tokens || 0;
    }
  }

  return {
    text: fullText,
    reasoning: fullReasoning,
    tokensUsed: promptTokens + completionTokens,
    cacheCreationTokens,
    cacheReadTokens,
  };
};

module.exports = { callOpenAI, callOpenAIStream };
