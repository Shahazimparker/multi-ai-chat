// ============================================================
// FILE: backend/services/ai/gemini.service.js
// PURPOSE: Calls Google Gemini API
// CHANGE: Model names in config/models.js
// ============================================================

const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * callGemini — sends messages to Gemini API
 * @param {string} modelName  Gemini model identifier
 * @param {string} apiKey     Gemini API key
 * @param {Array}  messages   [{role: 'user'|'model', content: string}]
 * @returns {Object}          {text, tokensUsed}
 */
const callGemini = async (modelName, apiKey, messages) => {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  // Convert messages to Gemini's {role, parts} format
  // Gemini uses 'model' instead of 'assistant'
  const history = messages.slice(0, -1).map(m => ({
    role:  m.role === 'assistant' ? 'model' : m.role,
    parts: [{ text: m.content }],
  }));

  const lastMessage = messages[messages.length - 1];

  const chat   = model.startChat({ history });
  const result = await chat.sendMessage(lastMessage.content);
  const text   = result.response.text();

  // Gemini's usageMetadata for token counting
  const tokensUsed = result.response.usageMetadata?.totalTokenCount || 0;

  return { text, tokensUsed };
};

module.exports = { callGemini };
