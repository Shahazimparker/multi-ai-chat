// ============================================================
// FILE: backend/services/ai/unified.service.js
// PURPOSE: Shared OpenAI-compatible caller for unified providers
// ============================================================

const OpenAI = require('openai');
const OpenAIClient = /** @type {any} */ (OpenAI?.default || OpenAI);

/**
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

module.exports = { callOpenAICompatible };
