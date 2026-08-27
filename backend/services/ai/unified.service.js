// ============================================================
// FILE: backend/services/ai/unified.service.js
// PURPOSE: Shared OpenAI-compatible caller for unified providers
// ============================================================

const OpenAI = require('openai');
const { extractCacheUsage } = require('./promptCache.service');
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
    ...extractCacheUsage(response.usage),
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
 *  onChunk: (text: string) => void,
 *  onReasoning?: (text: string) => void
 * }} options
 * @returns {Promise<{text: string, reasoning: string, tokensUsed: number, cacheCreationTokens: number, cacheReadTokens: number, toolCalls: Array}>}
 */
const callOpenAICompatibleStream = async ({ baseURL, apiKey, modelName, messages, system, tools, toolChoice, signal, onChunk, onReasoning }) => {
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
    // Without this opt-in, OpenAI-compatible hosts never emit a usage-bearing
    // chunk during a stream — every streamed call would silently bill 0 tokens.
    stream_options: { include_usage: true },
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
  // No OpenRouter-specific opt-in here: OpenRouter has deprecated both
  // `usage: { include: true }` and `stream_options: { include_usage: true }`,
  // and now always returns full usage in the final SSE message regardless.
  // The `stream_options` above is kept because this same function serves other
  // OpenAI-compatible hosts (AnyAPI, Together) that do still require it.

  const stream = await client.chat.completions.create(requestBody, { signal });

  let fullText = '';
  let fullReasoning = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  const toolCallsMap = new Map();

  for await (const chunk of stream) {
    const deltaObj = chunk.choices?.[0]?.delta || {};
    // OpenRouter and vLLM use `reasoning`; DeepSeek-style hosts behind the same
    // OpenAI-compatible surface use `reasoning_content`. Accept either.
    const reasoningDelta = deltaObj.reasoning || deltaObj.reasoning_content;
    if (reasoningDelta) {
      fullReasoning += reasoningDelta;
      if (onReasoning) onReasoning(reasoningDelta);
    }
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
      const c = extractCacheUsage(chunk.usage);
      cacheCreationTokens = c.cacheCreationTokens;
      cacheReadTokens = c.cacheReadTokens;
    }
    // OpenRouter puts usage in x-usage on the final chunk
    if (chunk['x-usage']) {
      promptTokens = chunk['x-usage'].prompt_tokens || 0;
      completionTokens = chunk['x-usage'].completion_tokens || 0;
      const xc = extractCacheUsage(chunk['x-usage']);
      cacheCreationTokens = xc.cacheCreationTokens;
      cacheReadTokens = xc.cacheReadTokens;
    }
  }

  const toolCalls = Array.from(toolCallsMap.values());
  return {
    text: fullText,
    reasoning: fullReasoning,
    tokensUsed: promptTokens + completionTokens,
    cacheCreationTokens,
    cacheReadTokens,
    toolCalls,
  };
};

module.exports = { callOpenAICompatible, callOpenAICompatibleStream };
