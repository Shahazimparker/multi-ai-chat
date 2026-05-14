// ============================================================
// FILE: backend/services/ai/together.service.js
// PURPOSE: Calls Together AI API
// ============================================================

const { callOpenAICompatible } = require('./unified.service');

const callTogether = async (modelName, apiKey, messages, signal = null) => {
  return callOpenAICompatible({
    baseURL: 'https://api.together.xyz/v1',
    apiKey,
    modelName,
    messages,
    signal,
  });
};

module.exports = { callTogether };
