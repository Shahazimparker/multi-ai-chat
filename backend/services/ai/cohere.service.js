// ============================================================
// FILE: backend/services/ai/cohere.service.js
// PURPOSE: Calls Cohere API (chat endpoint)
// ============================================================

const axios = require('axios');

const callCohere = async (modelName, apiKey, messages) => {
  // Cohere separates last user message from chat history
  const chatHistory = messages.slice(0, -1).map(m => ({
    role:    m.role === 'user' ? 'USER' : 'CHATBOT',
    message: m.content,
  }));
  const lastMessage = messages[messages.length - 1].content;

  const response = await axios.post(
    'https://api.cohere.ai/v1/chat',
    {
      model:        modelName,
      message:      lastMessage,
      chat_history: chatHistory,
      max_tokens:   4096,
      temperature:  0.7,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const text       = response.data.text || '';
  const tokensUsed = (response.data.meta?.tokens?.input_tokens || 0) +
                     (response.data.meta?.tokens?.output_tokens || 0);
  return { text, tokensUsed };
};

module.exports = { callCohere };
