// ============================================================
// FILE: backend/services/ai/openrouter.service.js
// PURPOSE: Calls OpenRouter API
// ============================================================

const { callOpenAICompatible, callOpenAICompatibleStream } = require('./unified.service');

/**
 * Shared helper to build base config (used by both streaming and non-streaming)
 */
function buildOpenRouterConfig(modelName, apiKey, messages, signal) {
  const isClaudeModel = modelName.includes('claude');
  const isGPT4Turbo = modelName.includes('gpt-4-turbo');
  const systemMessages = messages.filter(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');

  const baseConfig = {
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
    modelName,
    messages: chatMessages,
    signal,
  };

  if (systemMessages.length > 0) {
    if (isClaudeModel || isGPT4Turbo) {
      baseConfig.system = systemMessages.map((m, i) => ({
        type: "text",
        text: m.content,
        ...(i === 0 ? { cache_control: { type: "ephemeral" } } : {}),
      }));
    } else {
      const systemText = systemMessages.map(m => m.content).join('\n\n');
      baseConfig.messages = [
        { role: 'system', content: systemText },
        ...chatMessages,
      ];
    }
  }
  return baseConfig;
}

/**
 * @param {string} modelName
 * @param {string} apiKey
 * @param {Array} messages
 * @param {AbortSignal|null} signal
 * @returns {Promise<Object>}
 */
const callOpenRouter = async (modelName, apiKey, messages, signal = null) => {
  const baseConfig = buildOpenRouterConfig(modelName, apiKey, messages, signal);
  const response = await callOpenAICompatible(baseConfig);

  return {
    text: response.text,
    tokensUsed: response.tokensUsed,
    cacheCreationTokens: response.cacheCreationTokens || 0,
    cacheReadTokens: response.cacheReadTokens || 0,
  };
};

/**
 * Streaming variant for OpenRouter.
 * @param {string} modelName
 * @param {string} apiKey
 * @param {Array} messages
 * @param {AbortSignal|null} signal
 * @param {(text: string) => void} onChunk
 * @returns {Promise<{text: string, tokensUsed: number, cacheCreationTokens: number, cacheReadTokens: number}>}
 */
const callOpenRouterStream = async (modelName, apiKey, messages, signal = null, onChunk) => {
  const baseConfig = buildOpenRouterConfig(modelName, apiKey, messages, signal);
  const response = await callOpenAICompatibleStream({ ...baseConfig, onChunk });

  return {
    text: response.text,
    tokensUsed: response.tokensUsed,
    cacheCreationTokens: response.cacheCreationTokens || 0,
    cacheReadTokens: response.cacheReadTokens || 0,
  };
};

module.exports = { callOpenRouter, callOpenRouterStream };
