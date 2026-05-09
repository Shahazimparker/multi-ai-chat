// ============================================================
// FILE: backend/services/ai/openai.service.js
// PURPOSE: Calls OpenAI GPT API
// ============================================================

const OpenAI = require('openai');

const callOpenAI = async (modelName, apiKey, messages) => {
  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model: modelName,
    max_tokens: 4096,
    messages,
    // Prompt caching (if model supports - GPT-4 Turbo+)
  });

  return {
    text: response.choices[0].message.content,
    tokensUsed: response.usage.prompt_tokens + response.usage.completion_tokens,
    cacheCreationTokens: response.usage.cache_creation_input_tokens || 0,  // ← Add
    cacheReadTokens: response.usage.cache_read_input_tokens || 0,          // ← Add
  };
};

module.exports = { callOpenAI };
