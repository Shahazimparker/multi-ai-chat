const Anthropic = require('@anthropic-ai/sdk');

const callClaude = async (modelName, apiKey, messages, signal = null) => {
  const client = new Anthropic({ apiKey });

  // Extract system messages from the messages array
  const systemMessages = messages.filter(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');

  // Build system parameter: first message (static) gets cache_control,
  // subsequent messages (dynamic) do not — enables prompt caching
  const system = systemMessages.length > 0
    ? systemMessages.map((m, i) => ({
        type: "text",
        text: m.content,
        ...(i === 0 ? { cache_control: { type: "ephemeral" } } : {}),
      }))
    : undefined;

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

module.exports = { callClaude };