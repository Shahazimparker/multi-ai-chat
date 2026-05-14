// ============================================================
// FILE: backend/services/ai/anyapi.service.js
// PURPOSE: Calls AnyAPI
// ============================================================

const { callOpenAICompatible } = require('./unified.service');

const callAnyAPI = async (modelName, apiKey, messages, signal = null) => {
  return callOpenAICompatible({
    baseURL: 'https://api.anyapi.ai/v1',
    apiKey,
    modelName,
    messages,
    signal,
  });
};

module.exports = { callAnyAPI };
