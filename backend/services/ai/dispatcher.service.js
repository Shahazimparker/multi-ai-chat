// ============================================================
// FILE: backend/services/ai/dispatcher.service.js
// PURPOSE: Single entry point — routes to correct AI provider
//          based on model config. Add new providers here.
// ============================================================

const { callGemini } = require('./gemini.service');
const { callGroq } = require('./groq.service');
const { callMistral } = require('./mistral.service');
const { callCohere } = require('./cohere.service');
const { callOpenAI } = require('./openai.service');
const { callClaude } = require('./claude.service');
const { callOpenRouter } = require('./openrouter.service');
const { callTogether } = require('./together.service');
const { callAnyAPI } = require('./anyapi.service');
const { calldeepseekAPI } = require('./deepseek.service');

/**
 * dispatchToAI — routes messages to the correct AI provider
 * @param {Object} modelConfig  from config/models.js
 * @param {Array}  messages     [{role, content}]
 * @param {AbortSignal} signal  optional signal for cancellation
 * @returns {Object}            {text, tokensUsed}
 */
const dispatchToAI = async (modelConfig, messages, signal = null) => {
  const { provider, model, apiKey } = modelConfig;

  // Validate API key exists before calling
  if (!apiKey) {
    throw new Error(`API key not configured for provider: ${provider}. Add it to .env`);
  }

  switch (provider) {
    case 'gemini': return callGemini(model, apiKey, messages, signal);
    case 'groq': return callGroq(model, apiKey, messages, signal);
    case 'mistral': return callMistral(model, apiKey, messages, signal);
    case 'cohere': return callCohere(model, apiKey, messages, signal);
    case 'openai': return callOpenAI(model, apiKey, messages, signal);
    case 'claude': return callClaude(model, apiKey, messages, signal);
    case 'openrouter': return callOpenRouter(model, apiKey, messages, signal);
    case 'together': return callTogether(model, apiKey, messages, signal);
    case 'anyapi': return callAnyAPI(model, apiKey, messages, signal);
    case 'deepseek': return calldeepseekAPI(model, apiKey, messages, signal, modelConfig);

    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
};

module.exports = { dispatchToAI };
