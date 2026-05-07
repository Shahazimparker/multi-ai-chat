// ============================================================
// FILE: backend/services/ai/unified.service.js
// PURPOSE: Calls OpenRouter, Together AI, and AnyAPI
// ============================================================

const OpenAI = require('openai');

const PROVIDERS = {
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
  },
  together: {
    baseURL: 'https://api.together.xyz/v1',
  },
  anyapi: {
    baseURL: 'https://api.anyapi.ai/v1',
  },
};

const callUnified = async (provider, modelName, apiKey, messages) => {
  const providerConfig = PROVIDERS[provider];
  if (!providerConfig) {
    throw new Error(`Unknown unified provider: ${provider}`);
  }

  const client = new OpenAI({
    apiKey,
    baseURL: providerConfig.baseURL,
  });

  const response = await client.chat.completions.create({
    model: modelName,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    max_tokens: 4096,
    temperature: 0.7,
  });

  const text = response.choices?.[0]?.message?.content || '';
  const tokensUsed = response.usage?.total_tokens || 0;

  return { text, tokensUsed };
};

module.exports = { callUnified };