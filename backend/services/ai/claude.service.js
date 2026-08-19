const Anthropic = require('@anthropic-ai/sdk');

/**
 * Shared helper: build system param and chat messages from the full messages array.
 */
function extractClaudeParams(messages) {
  const systemMessages = messages.filter(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');
  const system = systemMessages.length > 0
    ? systemMessages.map((m, i) => ({
        type: "text",
        text: m.content,
        ...(i === 0 ? { cache_control: { type: "ephemeral" } } : {}),
      }))
    : undefined;
  return { system, chatMessages };
}

const callClaude = async (modelName, apiKey, messages, signal = null) => {
  const client = new Anthropic({ apiKey });
  const { system, chatMessages } = extractClaudeParams(messages);

  const response = await client.messages.create({
    model: modelName,
    max_tokens: 16000,
    ...(system ? { system } : {}),
    messages: chatMessages,
  }, { signal });

  return {
    text: response.content[0].type === 'text' ? response.content[0].text : '',
    tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
    cacheCreationTokens: response.usage.cache_creation_input_tokens || 0,
    cacheReadTokens: response.usage.cache_read_input_tokens || 0,
  };
};

/**
 * Streaming variant for Claude — yields text deltas via onChunk callback.
 * @param {string} modelName
 * @param {string} apiKey
 * @param {Array} messages
 * @param {AbortSignal|null} signal
 * @param {(text: string) => void} onChunk
 * @param {(text: string) => void} [onReasoning] — extended-thinking deltas
 * @param {object|null} [modelConfig] — set `reasoning` on the model in
 *   config/models.js to turn thinking on; omitted means no thinking, as before
 * @returns {Promise<{text: string, reasoning: string, tokensUsed: number, cacheCreationTokens: number, cacheReadTokens: number}>}
 */
const callClaudeStream = async (modelName, apiKey, messages, signal = null, onChunk, onReasoning, modelConfig = null) => {
  const client = new Anthropic({ apiKey });
  const { system, chatMessages } = extractClaudeParams(messages);

  // Extended thinking is opt-in per model. `budget_tokens` is rejected with a
  // 400 on Sonnet 5 / Opus 4.8 — adaptive thinking replaces it. `display`
  // defaults to "omitted" on those models, which streams thinking blocks with
  // empty text, so it has to be set explicitly for the reasoning UI to show
  // anything at all.
  const thinking = modelConfig?.reasoning
    ? { type: 'adaptive', display: 'summarized' }
    : null;

  const stream = await client.messages.create({
    model: modelName,
    max_tokens: 16000,
    ...(system ? { system } : {}),
    ...(thinking ? { thinking } : {}),
    messages: chatMessages,
    stream: true,
  }, { signal });

  let fullText = '';
  let fullReasoning = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      const delta = event.delta.text;
      fullText += delta;
      if (onChunk) onChunk(delta);
    }
    if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
      const delta = event.delta.thinking;
      if (delta) {
        fullReasoning += delta;
        if (onReasoning) onReasoning(delta);
      }
    }
    // Capture usage from the final message event
    if (event.type === 'message_delta' && event.usage) {
      outputTokens = event.usage.output_tokens || 0;
    }
    if (event.type === 'message_start' && event.message?.usage) {
      inputTokens = event.message.usage.input_tokens || 0;
      cacheCreationTokens = event.message.usage.cache_creation_input_tokens || 0;
      cacheReadTokens = event.message.usage.cache_read_input_tokens || 0;
    }
  }

  return {
    text: fullText,
    reasoning: fullReasoning,
    tokensUsed: inputTokens + outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
  };
};

module.exports = { callClaude, callClaudeStream };