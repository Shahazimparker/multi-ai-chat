// ============================================================
// FILE: backend/services/ai/openrouter.service.js
// PURPOSE: Calls OpenRouter API
// ============================================================

const { callOpenAICompatible } = require('./unified.service');

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

  // Claude models: use Anthropic-style system parameter for prompt caching
  // Other models: prepend system as a system-role message in the messages array
  if (systemMessages.length > 0) {
    const systemText = systemMessages.map(m => m.content).join('\n');

    if (isClaudeModel || isGPT4Turbo) {
      // Anthropic-style system with cache control
      baseConfig.system = [{
        type: "text",
        text: systemText,
        cache_control: { type: "ephemeral" }
      }];
    } else {
      // OpenAI-compatible: prepend system message
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