// ============================================================
// FILE: backend/services/ai/claude.service.js
// PURPOSE: Calls Anthropic Claude API
// ============================================================

const Anthropic = require('@anthropic-ai/sdk');

const callClaude = async (modelName, apiKey, messages) => {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: modelName,
    max_tokens: 4096,
    messages,
    // Enable prompt caching for cost savings
    system: [{
      type: "text",
      text: "You are a helpful AI assistant.",
      cache_control: { type: "ephemeral" }  // ← Cache enabled
    }],
  });

  return {
    text: response.content[0].type === 'text' ? response.content[0].text : '',
    tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
    cacheCreationTokens: response.usage.cache_creation_input_tokens || 0,
    cacheReadTokens: response.usage.cache_read_input_tokens || 0,
  };
};

module.exports = { callClaude };
