// ============================================================
// FILE: backend/services/ai/openrouter.service.js
// PURPOSE: Calls OpenRouter API
// ============================================================

const { callOpenAICompatible, callOpenAICompatibleStream } = require('./unified.service');

const OPENROUTER_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'generate_ppt',
      description: 'Generate a PowerPoint presentation from structured slide data.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          subtitle: { type: 'string' },
          theme: { type: 'string', enum: ['modern_corporate', 'startup_bold', 'clean_minimal'] },
          style: { type: 'string', enum: ['modern_corporate', 'startup_bold', 'clean_minimal'] },
          slides: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                layout: { type: 'string', enum: ['title_bullets', 'two_column', 'cards', 'quote', 'data_story'] },
                subtitle: { type: 'string' },
                footerNote: { type: 'string' },
                bullets: { type: 'array', items: { type: 'string' } },
                content: { type: 'string' },
              },
              required: ['title'],
            },
          },
        },
        required: ['title', 'slides'],
      },
    },
  },
];

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
    tools: OPENROUTER_TOOLS,
    toolChoice: 'auto',
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
    toolCalls: response.toolCalls || [],
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
    toolCalls: response.toolCalls || [],
  };
};

module.exports = { callOpenRouter, callOpenRouterStream };
