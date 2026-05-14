// ============================================================
// FILE: backend/services/ai/unified.service.js
// PURPOSE: Shared OpenAI-compatible caller for unified providers
// ============================================================

const OpenAI = require('openai');

const callOpenAICompatible = async ({ baseURL, apiKey, modelName, messages, system }) => {
  const client = new OpenAI({
    apiKey,
    baseURL,
    defaultHeaders: { 'HTTP-Referer': 'https://openrouter.ai' }
  });

  const requestBody = {
    model: modelName,
    max_tokens: 16000,
    messages,
  };

  // Add system if provided (for cache control)
  if (system) {
    requestBody.system = system;
  }

  const response = await client.chat.completions.create(requestBody);

  return {
    text: response.choices[0].message.content,
    tokensUsed: response.usage.prompt_tokens + response.usage.completion_tokens,
    cacheCreationTokens: response.usage.cache_creation_input_tokens || 0,
    cacheReadTokens: response.usage.cache_read_input_tokens || 0,
  };
};

module.exports = { callOpenAICompatible };