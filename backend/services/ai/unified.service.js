// ============================================================
// FILE: backend/services/ai/unified.service.js
// PURPOSE: Shared OpenAI-compatible caller for unified providers
// ============================================================

const OpenAI = require('openai');
const OpenAIClient = /** @type {any} */ (OpenAI?.default || OpenAI);

/**
 * Non-streaming call — returns complete response.
 * @param {{
 *  baseURL: string,
 *  apiKey: string,
 *  modelName: string,
 *  messages: Array,
 *  system?: any,
 *  signal?: AbortSignal|null
 * }} options
 * @returns {Promise<{text: string, tokensUsed: number, cacheCreationTokens: number, cacheReadTokens: number}>}
 */
const callOpenAICompatible = async ({ baseURL, apiKey, modelName, messages, system, signal }) => {
  const client = new OpenAIClient({
    apiKey,
    baseURL,
    defaultHeaders: { 'HTTP-Referer': 'https://openrouter.ai' }
  });

  const requestBody = {
    model: modelName,
    max_tokens: 16000,
    messages,
  };

  // Add system field only if explicitly provided (OpenRouter supports this for Claude)
  if (system) {
    requestBody.system = typeof system === 'string'
      ? system
      : system;
  }

  const response = await client.chat.completions.create(requestBody, { signal });

  return {
    text: response.choices[0].message.content,
    tokensUsed: response.usage.prompt_tokens + response.usage.completion_tokens,
    cacheCreationTokens: response.usage.cache_creation_input_tokens || 0,
    cacheReadTokens: response.usage.cache_read_input_tokens || 0,
  };
};

/**
 * Streaming call — yields text chunks via onChunk callback as they arrive.
 * Resolves with the same shape as the non-streaming variant.
 *
 * @param {{
 *  baseURL: string,
 *  apiKey: string,
 *  modelName: string,
 *  messages: Array,
 *  system?: any,
 *  signal?: AbortSignal|null,
 *  onChunk: (text: string) => void
 * }} options
 * @returns {Promise<{text: string, tokensUsed: number, cacheCreationTokens: number, cacheReadTokens: number}>}
 */
const callOpenAICompatibleStream = async ({ baseURL, apiKey, modelName, messages, system, signal, onChunk }) => {
  const client = new OpenAIClient({
    apiKey,
    baseURL,
    defaultHeaders: { 'HTTP-Referer': 'https://openrouter.ai' }
  });

  const requestBody = {
    model: modelName,
    max_tokens: 16000,
    messages,
    stream: true,
  };

  if (system) {
    requestBody.system = typeof system === 'string'
      ? system
      : system;
  }

  const stream = await client.chat.completions.create(requestBody, { signal });

  let fullText = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      fullText += delta;
      if (onChunk) onChunk(delta);
    }

    // Capture usage from the final chunk (x-usage or usage)
    if (chunk.usage) {
      promptTokens = chunk.usage.prompt_tokens || 0;
      completionTokens = chunk.usage.completion_tokens || 0;
      cacheCreationTokens = chunk.usage.cache_creation_input_tokens || 0;
      cacheReadTokens = chunk.usage.cache_read_input_tokens || 0;
    }
    // OpenRouter puts usage in x-usage on the final chunk
    if (chunk['x-usage']) {
      promptTokens = chunk['x-usage'].prompt_tokens || 0;
      completionTokens = chunk['x-usage'].completion_tokens || 0;
      cacheCreationTokens = chunk['x-usage'].cache_creation_input_tokens || 0;
      cacheReadTokens = chunk['x-usage'].cache_read_input_tokens || 0;
    }
  }

  return {
    text: fullText,
    tokensUsed: promptTokens + completionTokens,
    cacheCreationTokens,
    cacheReadTokens,
  };
};

module.exports = { callOpenAICompatible, callOpenAICompatibleStream };
