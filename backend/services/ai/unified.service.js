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
 *  tools?: Array,
 *  toolChoice?: string|object,
 *  signal?: AbortSignal|null
 * }} options
 * @returns {Promise<{text: string, tokensUsed: number, cacheCreationTokens: number, cacheReadTokens: number, toolCalls: Array}>}
 */
const callOpenAICompatible = async ({ baseURL, apiKey, modelName, messages, system, tools, toolChoice, signal }) => {
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
  if (Array.isArray(tools) && tools.length > 0) {
    requestBody.tools = tools;
    requestBody.tool_choice = toolChoice || 'auto';
  }

  const response = await client.chat.completions.create(requestBody, { signal });
  const assistantMessage = response.choices?.[0]?.message || {};

  return {
    text: assistantMessage.content || '',
    tokensUsed: (response.usage?.prompt_tokens || 0) + (response.usage?.completion_tokens || 0),
    cacheCreationTokens: response.usage.cache_creation_input_tokens || 0,
    cacheReadTokens: response.usage.cache_read_input_tokens || 0,
    toolCalls: assistantMessage.tool_calls || [],
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
 *  tools?: Array,
 *  toolChoice?: string|object,
 *  signal?: AbortSignal|null,
 *  onChunk: (text: string) => void
 * }} options
 * @returns {Promise<{text: string, tokensUsed: number, cacheCreationTokens: number, cacheReadTokens: number, toolCalls: Array}>}
 */
const callOpenAICompatibleStream = async ({ baseURL, apiKey, modelName, messages, system, tools, toolChoice, signal, onChunk }) => {
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
  if (Array.isArray(tools) && tools.length > 0) {
    requestBody.tools = tools;
    requestBody.tool_choice = toolChoice || 'auto';
  }

  const stream = await client.chat.completions.create(requestBody, { signal });

  let fullText = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  const toolCallsMap = new Map();

  for await (const chunk of stream) {
    const deltaObj = chunk.choices?.[0]?.delta || {};
    const delta = deltaObj.content;
    if (delta) {
      fullText += delta;
      if (onChunk) onChunk(delta);
    }
    if (Array.isArray(deltaObj.tool_calls)) {
      for (const tc of deltaObj.tool_calls) {
        const idx = Number.isInteger(tc?.index) ? tc.index : 0;
        if (!toolCallsMap.has(idx)) {
          toolCallsMap.set(idx, {
            id: tc?.id,
            type: tc?.type || 'function',
            function: {
              name: tc?.function?.name || '',
              arguments: '',
            },
          });
        }
        const curr = toolCallsMap.get(idx);
        if (tc?.id) curr.id = tc.id;
        if (tc?.function?.name) curr.function.name = tc.function.name;
        if (typeof tc?.function?.arguments === 'string') {
          curr.function.arguments += tc.function.arguments;
        }
      }
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

  const toolCalls = Array.from(toolCallsMap.values());
  return {
    text: fullText,
    tokensUsed: promptTokens + completionTokens,
    cacheCreationTokens,
    cacheReadTokens,
    toolCalls,
  };
};

module.exports = { callOpenAICompatible, callOpenAICompatibleStream };
