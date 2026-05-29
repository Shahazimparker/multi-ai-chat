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
 * @returns {Promise<{text: string, tokensUsed: number, cacheCreationTokens: number, cacheReadTokens: number}>}
 */
const callClaudeStream = async (modelName, apiKey, messages, signal = null, onChunk) => {
  const client = new Anthropic({ apiKey });
  const { system, chatMessages } = extractClaudeParams(messages);

  const stream = await client.messages.create({
    model: modelName,
    max_tokens: 16000,
    ...(system ? { system } : {}),
    messages: chatMessages,
    stream: true,
  }, { signal });

  let fullText = '';
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
    tokensUsed: inputTokens + outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
  };
};

module.exports = { callClaude, callClaudeStream };