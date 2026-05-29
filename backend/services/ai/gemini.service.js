// ============================================================
// FILE: backend/services/ai/gemini.service.js
// PURPOSE: Calls Google Gemini API
// CHANGE: Model names in config/models.js
// ============================================================

const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Shared helper to build Gemini model params from messages.
 */
function buildGeminiModel(genAI, modelName, messages) {
  const systemMessages = messages.filter(m => m.role === 'system');
  const systemInstruction = systemMessages.length > 0
    ? systemMessages.map(m => m.content).join('\n')
    : undefined;

  const modelParams = { model: modelName };
  if (systemInstruction) {
    modelParams.systemInstruction = {
      role: 'system',
      parts: [{ text: systemInstruction }],
    };
  }
  return genAI.getGenerativeModel(modelParams);
}

/**
 * Non-streaming call — sends messages to Gemini API
 * @param {string} modelName  Gemini model identifier
 * @param {string} apiKey     Gemini API key
 * @param {Array}  messages   [{role: 'user'|'model', content: string}]
 * @param {AbortSignal} signal  optional signal for cancellation
 * @returns {Object}          {text, tokensUsed}
 */
const callGemini = async (modelName, apiKey, messages, signal = null) => {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = buildGeminiModel(genAI, modelName, messages);

  const chatMessages = messages.filter(m => m.role !== 'system');
  const lastMessage = chatMessages[chatMessages.length - 1];

  const history = chatMessages.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : m.role,
    parts: [{ text: m.content }],
  }));

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

  const text = result.response.text();
  const tokensUsed = result.response.usageMetadata?.totalTokenCount || 0;

  return { text, tokensUsed };
};

/**
 * Streaming variant for Gemini — yields text deltas via onChunk callback.
 * @param {string} modelName
 * @param {string} apiKey
 * @param {Array} messages
 * @param {AbortSignal|null} signal
 * @param {(text: string) => void} onChunk
 * @returns {Promise<{text: string, tokensUsed: number}>}
 */
const callGeminiStream = async (modelName, apiKey, messages, signal = null, onChunk) => {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = buildGeminiModel(genAI, modelName, messages);

  const chatMessages = messages.filter(m => m.role !== 'system');
  const lastMessage = chatMessages[chatMessages.length - 1];

  const history = chatMessages.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : m.role,
    parts: [{ text: m.content }],
  }));

  const chat = model.startChat({ history });

  // Use sendMessageStream instead of sendMessage
  const resultPromise = chat.sendMessageStream(lastMessage.content);

  const result = await Promise.race([
    resultPromise,
    new Promise((_, reject) => {
      if (signal?.aborted) reject({ name: 'AbortError' });
      signal?.addEventListener('abort', () => reject({ name: 'AbortError' }), { once: true });
    })
  ]);

  let fullText = '';
  let tokensUsed = 0;

  for await (const item of result.stream) {
    const delta = item.text();
    if (delta) {
      fullText += delta;
      if (onChunk) onChunk(delta);
    }
  }

  // Get token usage from the aggregated response
  const response = await result.response;
  tokensUsed = response.usageMetadata?.totalTokenCount || 0;

  return { text: fullText, tokensUsed };
};

module.exports = { callGemini, callGeminiStream };
