// ============================================================
// FILE: backend/services/ai/openrouter.service.js
// PURPOSE: Calls OpenRouter API
// ============================================================

const { callOpenAICompatible } = require('./unified.service');

const callOpenRouter = async (modelName, apiKey, messages) => {
  return callOpenAICompatible({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
    modelName,
    messages,
  });
};

module.exports = { callOpenRouter };