// ============================================================
// FILE: backend/services/ai/mistral.service.js
// PURPOSE: Calls Mistral AI API
// ============================================================

const axios = require('axios');

const callMistral = async (modelName, apiKey, messages) => {
  const response = await axios.post(
    'https://api.mistral.ai/v1/chat/completions',
    {
      model:       modelName,
      messages:    messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens:  4096,
      temperature: 0.7,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const text       = response.data.choices[0]?.message?.content || '';
  const tokensUsed = response.data.usage?.total_tokens || 0;
  return { text, tokensUsed };
};

module.exports = { callMistral };
