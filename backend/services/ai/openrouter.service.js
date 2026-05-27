// ============================================================
// FILE: backend/services/ai/openrouter.service.js
// PURPOSE: Calls OpenRouter API
// ============================================================

const { callOpenAICompatible } = require('./unified.service');

/**
 * @param {string} modelName
 * @param {string} apiKey
 * @param {Array} messages
 * @param {AbortSignal|null} signal
 * @returns {Promise<Object>}
 */
const callOpenRouter = async (modelName, apiKey, messages, signal = null) => {
  // Check if model supports cache
  const isClaudeModel = modelName.includes('claude');
  const isGPT4Turbo = modelName.includes('gpt-4-turbo');

  // Extract system messages from the messages array
  const systemMessages = messages.filter(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');

  const baseConfig = {
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
    modelName,
    messages: chatMessages,
    signal,
  };

  // Claude models: use Anthropic-style system parameter with prompt caching
  // Other models: prepend system as a system-role message in the messages array
  if (systemMessages.length > 0) {
    if (isClaudeModel || isGPT4Turbo) {
      // Anthropic-style system — cache only the first (static) message
      baseConfig.system = systemMessages.map((m, i) => ({
        type: "text",
        text: m.content,
        ...(i === 0 ? { cache_control: { type: "ephemeral" } } : {}),
      }));
    } else {
      // OpenAI-compatible: concatenate all system messages, prepend as one
      const systemText = systemMessages.map(m => m.content).join('\n\n');
      baseConfig.messages = [
        { role: 'system', content: systemText },
        ...chatMessages,
      ];
    }
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
