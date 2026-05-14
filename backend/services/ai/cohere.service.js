// ============================================================
// FILE: backend/services/ai/cohere.service.js
// PURPOSE: Calls Cohere API (chat endpoint)
// ============================================================

const axios = require('axios');

const callCohere = async (modelName, apiKey, messages, signal = null) => {
  // Extract system preamble from messages (Cohere uses preamble_override for this)
  const systemMessages = messages.filter(m => m.role === 'system');
  const preamble = systemMessages.length > 0
    ? systemMessages.map(m => m.content).join('\n')
    : undefined;

  // Chat history: system messages removed, non-user → CHATBOT, user → USER
  const nonSystemMsgs = messages.filter(m => m.role !== 'system');
  const chatHistory = nonSystemMsgs.slice(0, -1).map(m => ({
    role:    m.role === 'user' ? 'USER' : 'CHATBOT',
    message: m.content,
  }));
  const lastMessage = nonSystemMsgs[nonSystemMsgs.length - 1]?.content || '';

  const response = await axios.post(
    'https://api.cohere.ai/v1/chat',
    {
      model:        modelName,
      message:      lastMessage,
      chat_history: chatHistory,
      ...(preamble && { preamble_override: preamble }),
      max_tokens:   16000,
      temperature:  0.7,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal,
    }
  );

  const text       = response.data.text || '';
  const tokensUsed = (response.data.meta?.tokens?.input_tokens || 0) +
                     (response.data.meta?.tokens?.output_tokens || 0);
  return { text, tokensUsed };
};

module.exports = { callCohere };
