const Anthropic = require('@anthropic-ai/sdk');

const { resolveReasoning } = require('./reasoning.service');

// Minimum Anthropic accepts for a thinking budget on pre-4.6 models.
const HAIKU_THINKING_BUDGET_TOKENS = 4000;

/**
 * Map a resolved decision onto Anthropic's request shape.
 *
 * Two generations coexist here. Sonnet 4.6 and later take adaptive thinking
 * plus output_config.effort, and reject budget_tokens with a 400. Haiku 4.5
 * predates both: it needs {type:'enabled', budget_tokens} and errors on effort.
 * The registry distinguishes them by whether it lists any effort levels.
 *
 * `display` matters as much as `type`: it defaults to "omitted" on Sonnet 5 and
 * Opus 4.8, which streams thinking blocks with empty text — the reasoning panel
 * would sit there blank without an explicit "summarized".
 */
const buildClaudeThinkingParams = (decision) => {
  if (!decision.supported) return {};
  if (!decision.enabled) return { thinking: { type: 'disabled' } };

  if (!decision.effort) {
    return { thinking: { type: 'enabled', budget_tokens: HAIKU_THINKING_BUDGET_TOKENS } };
  }

  return {
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort: decision.effort },
  };
};

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
const callClaudeStream = async (modelName, apiKey, messages, signal = null, onChunk, onReasoning, modelConfig = null, reasoningRequest = {}) => {
  const client = new Anthropic({ apiKey });
  const { system, chatMessages } = extractClaudeParams(messages);

  const decision = resolveReasoning(modelConfig, reasoningRequest);
  const params = buildClaudeThinkingParams(decision);

  const stream = await client.messages.create({
    model: modelName,
    max_tokens: 16000,
    ...(system ? { system } : {}),
    ...params,
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