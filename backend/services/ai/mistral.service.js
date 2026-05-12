// ============================================================
// FILE: backend/services/ai/mistral.service.js
// PURPOSE: Calls Mistral AI API + Mistral Embeddings
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

const embedWithMistral = async (text, apiKey) => {
  const response = await axios.post(
    'https://api.mistral.ai/v1/embeddings',
    {
      model: 'mistral-embed',
      input: [text],
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  let vector = response.data.data[0].embedding; // 1024 dims
  // Pad to 1536 to match Supabase pgvector column
  if (vector.length < 1536) {
    vector = [...vector, ...new Array(1536 - vector.length).fill(0)];
  }
  return vector;
};

module.exports = { callMistral, embedWithMistral };