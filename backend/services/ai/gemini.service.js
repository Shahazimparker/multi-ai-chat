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
 * @param {AbortSignal} signal  optional signal for cancellation
 * @returns {Object}          {text, tokensUsed}
 */
const callGemini = async (modelName, apiKey, messages, signal = null) => {
  const genAI = new GoogleGenerativeAI(apiKey);

  const systemMessages = messages.filter(m => m.role === 'system');
  const systemInstruction = systemMessages.length > 0
    ? systemMessages.map(m => m.content).join('\n')
    : undefined;

  const chatMessages = messages.filter(m => m.role !== 'system');
  const lastMessage = chatMessages[chatMessages.length - 1];

  const history = chatMessages.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : m.role,
    parts: [{ text: m.content }],
  }));

  const modelParams = { model: modelName };
  if (systemInstruction) {
    modelParams.systemInstruction = {
      role: 'system',
      parts: [{ text: systemInstruction }],
    };
  }

  const model = genAI.getGenerativeModel(modelParams);
  const chat = model.startChat({ history });

  const resultPromise = chat.sendMessage(lastMessage.content);

  // Google SDK doesn't natively support AbortSignal yet, so we race it
  const result = await Promise.race([
    resultPromise,
    new Promise((_, reject) => {
      if (signal?.aborted) reject({ name: 'AbortError' });
      signal?.addEventListener('abort', () => reject({ name: 'AbortError' }), { once: true });
    })
  ]);

  const text   = result.response.text();

  // Gemini's usageMetadata for token counting
  const tokensUsed = result.response.usageMetadata?.totalTokenCount || 0;

  return { text, tokensUsed };
};

module.exports = { callGemini };
