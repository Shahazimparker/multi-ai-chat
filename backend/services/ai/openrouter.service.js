// ============================================================
// FILE: backend/services/ai/openrouter.service.js
// PURPOSE: Calls OpenRouter API
// ============================================================

const { callOpenAICompatible } = require('./unified.service');

const callOpenRouter = async (modelName, apiKey, messages) => {
  // Check if model supports cache
  const isClaudeModel = modelName.includes('claude');
  const isGPT4Turbo = modelName.includes('gpt-4-turbo');

  const baseConfig = {
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
    modelName,
    messages,
  };

  // Enable cache for Claude and GPT-4 Turbo models
  if (isClaudeModel || isGPT4Turbo) {
    baseConfig.system = [{
      type: "text",
      text: "You are a helpful AI assistant.",
      cache_control: { type: "ephemeral" }
    }];
  }

  const response = await callOpenAICompatible(baseConfig);

  // Extract cache tokens if present
  return {
    text: response.text,
    tokensUsed: response.tokensUsed,
    cacheCreationTokens: response.cacheCreationTokens || 0,
    cacheReadTokens: response.cacheReadTokens || 0,
  };
};

module.exports = { callOpenRouter };