// ============================================================
// FILE: backend/services/ai/dispatcher.service.js
// PURPOSE: Single entry point — routes to correct AI provider
//          based on model config. Add new providers here.
// ============================================================

const { callGemini, callGeminiStream } = require('./gemini.service');
const { callGroq, callGroqStream } = require('./groq.service');
const { callMistral, callMistralStream } = require('./mistral.service');
const { callCohere, callCohereStream } = require('./cohere.service');
const { callOpenAI, callOpenAIStream } = require('./openai.service');
const { callClaude, callClaudeStream } = require('./claude.service');
const { callOpenRouter, callOpenRouterStream } = require('./openrouter.service');
const { callTogether, callTogetherStream } = require('./together.service');
const { callAnyAPI, callAnyAPIStream } = require('./anyapi.service');
const { calldeepseekAPI, calldeepseekAPIStream } = require('./deepseek.service');

/**
 * dispatchToAI — routes messages to the correct AI provider (non-streaming)
 * @param {Object} modelConfig  from config/models.js
 * @param {Array}  messages     [{role, content}]
 * @param {AbortSignal} signal  optional signal for cancellation
 * @returns {Promise<Object>}   {text, tokensUsed}
 */
const dispatchToAI = async (modelConfig, messages, signal = null) => {
  const { provider, model, apiKey } = modelConfig;

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

/**
 * dispatchToAIStream — streaming dispatch.
 * Calls the provider's streaming variant and yields text deltas via onChunk.
 * Resolves with the same shape as dispatchToAI.
 *
 * @param {Object} modelConfig
 * @param {Array}  messages
 * @param {AbortSignal} signal
 * @param {(text: string) => void} onChunk  called with each text delta
 * @returns {Promise<{text: string, tokensUsed: number, cacheCreationTokens: number, cacheReadTokens: number}>}
 */
const dispatchToAIStream = async (modelConfig, messages, signal = null, onChunk) => {
  const { provider, model, apiKey } = modelConfig;

  if (!apiKey) {
    throw new Error(`API key not configured for provider: ${provider}. Add it to .env`);
  }

  switch (provider) {
    case 'gemini': return callGeminiStream(model, apiKey, messages, signal, onChunk);
    case 'groq': return callGroqStream(model, apiKey, messages, signal, onChunk);
    case 'mistral': return callMistralStream(model, apiKey, messages, signal, onChunk);
    case 'cohere': return callCohereStream(model, apiKey, messages, signal, onChunk);
    case 'openai': return callOpenAIStream(model, apiKey, messages, signal, onChunk);
    case 'claude': return callClaudeStream(model, apiKey, messages, signal, onChunk);
    case 'openrouter': return callOpenRouterStream(model, apiKey, messages, signal, onChunk);
    case 'together': return callTogetherStream(model, apiKey, messages, signal, onChunk);
    case 'anyapi': return callAnyAPIStream(model, apiKey, messages, signal, onChunk);
    case 'deepseek': return calldeepseekAPIStream(model, apiKey, messages, signal, modelConfig, onChunk);
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
};

module.exports = { dispatchToAI, dispatchToAIStream };
