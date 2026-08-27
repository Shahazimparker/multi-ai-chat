// ============================================================
// FILE: backend/services/ai/openrouter.service.js
// PURPOSE: Calls OpenRouter API
// ============================================================

const { callOpenAICompatible, callOpenAICompatibleStream } = require('./unified.service');
const { ANTHROPIC_MIN_CACHEABLE_TOKENS } = require('./promptCache.service');
const { estimateTokens } = require('../tokenBudget.service');

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
          theme: { type: 'string', enum: ['modern_corporate', 'startup_bold', 'clean_minimal', 'emerald_glass', 'sunset_warm', 'charcoal_lime', 'sandstone_editorial', 'ruby_noir', 'violet_tech', 'ocean_depth', 'rose_creative', 'mono_editorial'] },
          slides: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                layout: { type: 'string', enum: ['title_bullets', 'two_column', 'cards', 'quote', 'data_story', 'timeline', 'process_steps', 'comparison_split', 'swot_grid', 'kpi_dashboard', 'checklist', 'section_break', 'statistics_strip', 'faq', 'table_like'] },
                subtitle: { type: 'string' },
                footerNote: { type: 'string' },
                bullets: { type: 'array', items: { type: 'string' } },
                content: { type: 'string' },
                leftTitle: { type: 'string' },
                rightTitle: { type: 'string' },
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
function buildOpenRouterConfig(modelName, apiKey, messages, signal, { disableTools = false } = {}) {
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
    // Extraction-style callers (vision transcription, summarisation) pass
    // disableTools. Offering generate_ppt there invites a tool call in place of
    // the text they asked for, which reads downstream as an empty response.
    ...(disableTools ? {} : { tools: OPENROUTER_TOOLS, toolChoice: 'auto' }),
  };

  if (systemMessages.length > 0) {
    if (isClaudeModel || isGPT4Turbo) {
      // Same minimum as the direct Claude path: a breakpoint on a prefix under
      // Anthropic's floor is accepted and then silently ignored, so check before
      // paying the 1.25x cache-write rate for something that can never be read.
      const orCacheable = estimateTokens(systemMessages[0].content) >= ANTHROPIC_MIN_CACHEABLE_TOKENS;
      baseConfig.system = systemMessages.map((m, i) => ({
        type: "text",
        text: m.content,
        ...(i === 0 && orCacheable ? { cache_control: { type: "ephemeral" } } : {}),
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
 * @param {{disableTools?: boolean}} options
 * @returns {Promise<Object>}
 */
const callOpenRouter = async (modelName, apiKey, messages, signal = null, options = {}) => {
  const baseConfig = buildOpenRouterConfig(modelName, apiKey, messages, signal, options);
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
const callOpenRouterStream = async (modelName, apiKey, messages, signal = null, onChunk, onReasoning) => {
  const baseConfig = buildOpenRouterConfig(modelName, apiKey, messages, signal);
  const response = await callOpenAICompatibleStream({ ...baseConfig, onChunk, onReasoning });

  return {
    text: response.text,
    reasoning: response.reasoning || '',
    tokensUsed: response.tokensUsed,
    cacheCreationTokens: response.cacheCreationTokens || 0,
    cacheReadTokens: response.cacheReadTokens || 0,
    toolCalls: response.toolCalls || [],
  };
};

module.exports = { callOpenRouter, callOpenRouterStream };
