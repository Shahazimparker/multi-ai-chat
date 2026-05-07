// ============================================================
// FILE: backend/services/ai/unified.service.js
// PURPOSE: Shared OpenAI-compatible caller for unified providers
// ============================================================

const OpenAI = require('openai');

const callOpenAICompatible = async ({ baseURL, apiKey, modelName, messages }) => {
  const client = new OpenAI({
    apiKey,
    baseURL,
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

module.exports = { callOpenAICompatible };
