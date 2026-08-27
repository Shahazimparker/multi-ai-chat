// ============================================================
// FILE: backend/services/ai/openai.service.js
// PURPOSE: Calls OpenAI GPT API
// ============================================================

const OpenAI = require('openai');
const { extractCacheUsage } = require('./promptCache.service');

// OpenAI caches automatically above 1024 tokens; `prompt_cache_key` is a
// routing hint that lands requests sharing a prefix on the same backend, which
// OpenAI recommends setting explicitly from GPT-5.6 on.
const callOpenAI = async (modelName, apiKey, messages, signal = null, options = {}) => {
  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model: modelName,
    max_tokens: 16000,
    messages,
    ...(options.promptCacheKey ? { prompt_cache_key: options.promptCacheKey } : {}),
  }, { signal });

  return {
    text: response.choices[0].message.content,
    tokensUsed: response.usage.prompt_tokens + response.usage.completion_tokens,
    // OpenAI reports cache reads under usage.prompt_tokens_details.cached_tokens.
    // This used to read Anthropic's field names, which OpenAI never returns, so
    // it reported a flat zero however well caching was actually working.
    ...extractCacheUsage(response.usage),
  };
};

/**
 * Streaming variant — yields text deltas via onChunk callback.
 * @param {string} modelName
 * @param {string} apiKey
 * @param {Array} messages
 * @param {AbortSignal|null} signal
 * @param {(text: string) => void} onChunk
 * @returns {Promise<{text: string, tokensUsed: number, cacheCreationTokens: number, cacheReadTokens: number}>}
 */
const callOpenAIStream = async (modelName, apiKey, messages, signal = null, onChunk, onReasoning, options = {}) => {
  const client = new OpenAI({ apiKey });

  const stream = await client.chat.completions.create({
    model: modelName,
    max_tokens: 16000,
    messages,
    stream: true,
    // Without this, OpenAI never emits a usage-bearing chunk during a
    // stream — the call would silently bill 0 tokens.
    stream_options: { include_usage: true },
    ...(options.promptCacheKey ? { prompt_cache_key: options.promptCacheKey } : {}),
  }, { signal });

  let fullText = '';
  let fullReasoning = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;

  for await (const chunk of stream) {
    const reasoningDelta = chunk.choices?.[0]?.delta?.reasoning
      || chunk.choices?.[0]?.delta?.reasoning_content;
    if (reasoningDelta) {
      fullReasoning += reasoningDelta;
      if (onReasoning) onReasoning(reasoningDelta);
    }
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      fullText += delta;
      if (onChunk) onChunk(delta);
    }
    if (chunk.usage) {
      promptTokens = chunk.usage.prompt_tokens || 0;
      completionTokens = chunk.usage.completion_tokens || 0;
      const c = extractCacheUsage(chunk.usage);
      cacheCreationTokens = c.cacheCreationTokens;
      cacheReadTokens = c.cacheReadTokens;
    }
  }

  return {
    text: fullText,
    reasoning: fullReasoning,
    tokensUsed: promptTokens + completionTokens,
    cacheCreationTokens,
    cacheReadTokens,
  };
};

module.exports = { callOpenAI, callOpenAIStream };
