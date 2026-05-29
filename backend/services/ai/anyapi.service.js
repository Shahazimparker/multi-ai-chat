// ============================================================
// FILE: backend/services/ai/anyapi.service.js
// PURPOSE: Calls AnyAPI
// ============================================================

const { callOpenAICompatible, callOpenAICompatibleStream } = require('./unified.service');

const callAnyAPI = async (modelName, apiKey, messages, signal = null) => {
  return callOpenAICompatible({
    baseURL: 'https://api.anyapi.ai/v1',
    apiKey,
    modelName,
    messages,
    signal,
  });
};

/**
 * Streaming variant for AnyAPI.
 * @param {string} modelName
 * @param {string} apiKey
 * @param {Array} messages
 * @param {AbortSignal|null} signal
 * @param {(text: string) => void} onChunk
 * @returns {Promise<{text: string, tokensUsed: number, cacheCreationTokens: number, cacheReadTokens: number}>}
 */
const callAnyAPIStream = async (modelName, apiKey, messages, signal = null, onChunk) => {
  return callOpenAICompatibleStream({
    baseURL: 'https://api.anyapi.ai/v1',
    apiKey,
    modelName,
    messages,
    signal,
    onChunk,
  });
};

module.exports = { callAnyAPI, callAnyAPIStream };
