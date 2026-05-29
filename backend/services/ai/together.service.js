// ============================================================
// FILE: backend/services/ai/together.service.js
// PURPOSE: Calls Together AI API
// ============================================================

const { callOpenAICompatible, callOpenAICompatibleStream } = require('./unified.service');

const callTogether = async (modelName, apiKey, messages, signal = null) => {
  return callOpenAICompatible({
    baseURL: 'https://api.together.xyz/v1',
    apiKey,
    modelName,
    messages,
    signal,
  });
};

/**
 * Streaming variant for Together AI.
 * @param {string} modelName
 * @param {string} apiKey
 * @param {Array} messages
 * @param {AbortSignal|null} signal
 * @param {(text: string) => void} onChunk
 * @returns {Promise<{text: string, tokensUsed: number, cacheCreationTokens: number, cacheReadTokens: number}>}
 */
const callTogetherStream = async (modelName, apiKey, messages, signal = null, onChunk) => {
  return callOpenAICompatibleStream({
    baseURL: 'https://api.together.xyz/v1',
    apiKey,
    modelName,
    messages,
    signal,
    onChunk,
  });
};

module.exports = { callTogether, callTogetherStream };
