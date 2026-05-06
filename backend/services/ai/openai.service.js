// ============================================================
// FILE: backend/services/ai/openai.service.js
// PURPOSE: Calls OpenAI GPT API
// ============================================================

const OpenAI = require('openai');

const callOpenAI = async (modelName, apiKey, messages) => {
  const client   = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model:       modelName,
    messages:    messages.map(m => ({ role: m.role, content: m.content })),
    max_tokens:  4096,
    temperature: 0.7,
  });

  const text       = response.choices[0]?.message?.content || '';
  const tokensUsed = response.usage?.total_tokens || 0;
  return { text, tokensUsed };
};

module.exports = { callOpenAI };
