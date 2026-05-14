const Anthropic = require('@anthropic-ai/sdk');

const callClaude = async (modelName, apiKey, messages) => {
  const client = new Anthropic({ apiKey });

  // SEPARATE static system prompt (cacheable)
  const baseSystemPrompt = `You are a helpful AI assistant.
You provide accurate, concise, and helpful responses.
Always format code in code blocks when relevant.`;

  const response = await client.messages.create({
    model: modelName,
    max_tokens: 16000,
    system: [{
      type: "text",
      text: baseSystemPrompt,  // ✅ Static - will cache
      cache_control: { type: "ephemeral" }
    }],
    messages: messages,  // ✅ Dynamic content (user query + history)
  });

  return {
    text: response.content[0].type === 'text' ? response.content[0].text : '',
    tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
    cacheCreationTokens: response.usage.cache_creation_input_tokens || 0,
    cacheReadTokens: response.usage.cache_read_input_tokens || 0,
  };
};

module.exports = { callClaude };