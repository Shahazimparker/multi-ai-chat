// ============================================================
// FILE: backend/services/ai/groq.service.js
// PURPOSE: Calls Groq API (OpenAI-compatible interface)
// ============================================================

const Groq = require('groq-sdk');

const callGroq = async (modelName, apiKey, messages) => {
  const client   = new Groq({ apiKey });
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

module.exports = { callGroq };
