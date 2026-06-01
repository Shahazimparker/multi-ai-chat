/**
 * AI Provider Catalog
 *
 * All providers are OpenAI-compatible except Gemini and Cohere.
 * unified.service handles shared logic for OpenRouter / Together / AnyAPI.
 *
 * Request flow:
 *   dispatcher  ──►  gemini / groq / mistral / cohere / openai
 *                     claude / deepseek / openrouter / together / anyapi
 *                              └── openrouter / together / anyapi use unified
 */

const lazy = (path) => {
  let cache;
  return new Proxy({}, {
    get(_, key) { return (cache ??= require(path))[key]; }
  });
};

// Single entry point — route by model ID
exports.dispatcher = lazy('./dispatcher.service');

// Provider clients
exports.claude      = lazy('./claude.service');
exports.openai      = lazy('./openai.service');
exports.gemini      = lazy('./gemini.service');
exports.groq        = lazy('./groq.service');
exports.mistral     = lazy('./mistral.service');
exports.cohere      = lazy('./cohere.service');
exports.deepseek    = lazy('./deepseek.service');
exports.openrouter  = lazy('./openrouter.service');
exports.together    = lazy('./together.service');
exports.anyapi      = lazy('./anyapi.service');

// Shared OpenAI-compatible caller used by openrouter / together / anyapi
exports.unified     = lazy('./unified.service');
