// ============================================================
// FILE: backend/services/ai/dispatcher.service.js
// PURPOSE: Single entry point — routes to correct AI provider
//          based on model config. Add new providers here.
// ============================================================

const { callGemini }  = require('./gemini.service');
const { callGroq }    = require('./groq.service');
const { callMistral } = require('./mistral.service');
const { callCohere }  = require('./cohere.service');
const { callOpenAI }  = require('./openai.service');
const { callClaude }  = require('./claude.service');

/**
 * dispatchToAI — routes messages to the correct AI provider
 * @param {Object} modelConfig  from config/models.js
 * @param {Array}  messages     [{role, content}]
 * @returns {Object}            {text, tokensUsed}
 */
const dispatchToAI = async (modelConfig, messages) => {
  const { provider, model, apiKey } = modelConfig;

  // Validate API key exists before calling
  if (!apiKey) {
    throw new Error(`API key not configured for provider: ${provider}. Add it to .env`);
  }

  switch (provider) {
    case 'gemini':  return callGemini(model, apiKey, messages);
    case 'groq':    return callGroq(model, apiKey, messages);
    case 'mistral': return callMistral(model, apiKey, messages);
    case 'cohere':  return callCohere(model, apiKey, messages);
    case 'openai':  return callOpenAI(model, apiKey, messages);
    case 'claude':  return callClaude(model, apiKey, messages);

    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
};

module.exports = { dispatchToAI };
