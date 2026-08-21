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
const { AI_CALL_TIMEOUT_MS } = require('../../config/chatRuntime.config');

const isAbortLike = (err) =>
  err?.name === 'AbortError' || err?.name === 'TimeoutError' || err?.code === 'ABORT_ERR';

/**
 * callWithTimeout — bounds a single provider call.
 *
 * The timeout deliberately never touches the caller's AbortController: the chat
 * pipeline treats `abortController.signal.aborted` as a user cancellation and
 * returns silently, so aborting it here would drop the turn with no error shown.
 * Instead an internal controller is combined with the caller's, and a timeout is
 * reported as a plain Error whose message classifyError() maps to `timeout`.
 *
 * The timer is also raced against the call, because a provider that ignores its
 * signal would otherwise keep the invocation hanging regardless.
 *
 * @param {string} label            provider name, for the error message
 * @param {AbortSignal|null} userSignal  the caller's cancellation signal
 * @param {(signal: AbortSignal, touch: () => void) => Promise<any>} invoke
 *        receives the combined signal and a `touch` callback that restarts the
 *        idle timer — streaming passes it on every chunk.
 */
const callWithTimeout = async (label, userSignal, invoke) => {
  if (!(AI_CALL_TIMEOUT_MS > 0)) {
    return invoke(userSignal, () => {});
  }

  // Already cancelled: fail fast rather than start a call and wait out the full
  // timeout on an SDK that only reacts to the abort *event*.
  if (userSignal?.aborted) {
    const aborted = new Error('Request aborted before dispatch');
    aborted.name = 'AbortError';
    throw aborted;
  }

  const timeoutController = new AbortController();
  const combined = userSignal
    ? AbortSignal.any([userSignal, timeoutController.signal])
    : timeoutController.signal;

  // Wording matters: classifyError() keys the friendly "Request timeout" message
  // off the literal word "timeout".
  const message = `${label} timeout after ${AI_CALL_TIMEOUT_MS}ms with no response`;
  // `any`: checkJs resolves setTimeout to the DOM overload returning number,
  // which has no unref(). The runtime value here is a Node Timeout.
  /** @type {any} */
  let timer = null;
  let expired = false;
  let rejectTimeout = null;

  const touch = () => {
    if (expired) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      expired = true;
      timeoutController.abort();
      rejectTimeout?.(new Error(message));
    }, AI_CALL_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();
  };

  const timeoutGuard = new Promise((_, reject) => { rejectTimeout = reject; });
  touch();

  // Promise.resolve().then keeps a synchronous throw (unknown provider) on the
  // promise path so the .catch below is always attached to a real promise.
  const call = Promise.resolve().then(() => invoke(combined, touch));
  // A provider that ignores the abort may settle long after the race is lost;
  // swallow that so it never surfaces as an unhandled rejection.
  call.catch(() => {});

  try {
    return await Promise.race([call, timeoutGuard]);
  } catch (err) {
    // Our own abort surfaces from the SDK as a cancellation. Rewrite it, or the
    // pipeline would read it as the user hitting stop.
    if (expired && isAbortLike(err)) throw new Error(message, { cause: err });
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * dispatchToAI — routes messages to the correct AI provider (non-streaming)
 * @param {Object} modelConfig  from config/models.js
 * @param {Array}  messages     [{role, content}]
 * @param {AbortSignal} signal  optional signal for cancellation
 * @param {{disableTools?: boolean}} options  disableTools suppresses this app's
 *   chat tool schema — for extraction callers that want text, not a tool call
 * @returns {Promise<Object>}   {text, tokensUsed}
 */
const dispatchToAI = async (modelConfig, messages, signal = null, options = {}) => {
  const { provider, model, apiKey } = modelConfig;

  if (!apiKey) {
    throw new Error(`API key not configured for provider: ${provider}. Add it to .env`);
  }

  return callWithTimeout(provider, signal, (s) => {
    switch (provider) {
      case 'gemini': return callGemini(model, apiKey, messages, s);
      case 'groq': return callGroq(model, apiKey, messages, s);
      case 'mistral': return callMistral(model, apiKey, messages, s);
      case 'cohere': return callCohere(model, apiKey, messages, s);
      case 'openai': return callOpenAI(model, apiKey, messages, s);
      case 'claude': return callClaude(model, apiKey, messages, s);
      case 'openrouter': return callOpenRouter(model, apiKey, messages, s, options);
      case 'together': return callTogether(model, apiKey, messages, s);
      case 'anyapi': return callAnyAPI(model, apiKey, messages, s);
      case 'deepseek': return calldeepseekAPI(model, apiKey, messages, s, modelConfig);
      default:
        throw new Error(`Unknown AI provider: ${provider}`);
    }
  });
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
 * @param {{thinkingEnabled?: boolean, reasoningEffort?: string|null}} [reasoningRequest]
 *   the user's thinking choice; validated per model in reasoning.service.js
 * @param {(text: string) => void} [onReasoning]  called with each reasoning /
 *   thinking delta, for providers that expose one. Reasoning is never part of
 *   the answer, so callers render it separately.
 * @returns {Promise<{text: string, reasoning?: string, tokensUsed: number, cacheCreationTokens: number, cacheReadTokens: number}>}
 */
const dispatchToAIStream = async (modelConfig, messages, signal = null, onChunk, onReasoning, reasoningRequest = {}) => {
  const { provider, model, apiKey } = modelConfig;

  if (!apiKey) {
    throw new Error(`API key not configured for provider: ${provider}. Add it to .env`);
  }

  return callWithTimeout(`${provider} stream`, signal, (s, touch) => {
    // Each delta restarts the idle timer, so the cap applies to a stalled
    // stream rather than to a long but healthy one.
    const tick = typeof onChunk === 'function'
      ? (text) => { touch(); onChunk(text); }
      : onChunk;
    // Reasoning arrives before the first answer token on most providers, and on
    // a hard question that gap can be long. It has to reset the idle timer too,
    // or a healthy thinking phase reads as a stall and gets killed.
    const reasoningTick = typeof onReasoning === 'function'
      ? (text) => { touch(); onReasoning(text); }
      : onReasoning;

    switch (provider) {
      case 'gemini': return callGeminiStream(model, apiKey, messages, s, tick, modelConfig, reasoningRequest);
      case 'groq': return callGroqStream(model, apiKey, messages, s, tick, reasoningTick, modelConfig, reasoningRequest);
      case 'mistral': return callMistralStream(model, apiKey, messages, s, tick);
      case 'cohere': return callCohereStream(model, apiKey, messages, s, tick);
      case 'openai': return callOpenAIStream(model, apiKey, messages, s, tick, reasoningTick);
      case 'claude': return callClaudeStream(model, apiKey, messages, s, tick, reasoningTick, modelConfig, reasoningRequest);
      case 'openrouter': return callOpenRouterStream(model, apiKey, messages, s, tick, reasoningTick);
      case 'together': return callTogetherStream(model, apiKey, messages, s, tick);
      case 'anyapi': return callAnyAPIStream(model, apiKey, messages, s, tick);
      case 'deepseek': return calldeepseekAPIStream(model, apiKey, messages, s, modelConfig, tick, reasoningTick, reasoningRequest);
      default:
        throw new Error(`Unknown AI provider: ${provider}`);
    }
  });
};

module.exports = { dispatchToAI, dispatchToAIStream };
