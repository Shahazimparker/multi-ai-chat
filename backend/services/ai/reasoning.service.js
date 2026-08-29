// ============================================================
// FILE: backend/services/ai/reasoning.service.js
// PURPOSE: Turn a user's thinking choice into a validated, per-model decision.
// ============================================================
// The UI sends what the user asked for (thinkingEnabled + reasoningEffort); the
// model registry says what is actually possible. This module is the single
// place those two meet, so a stale client, a hand-rolled API call, or a topic
// saved against an old model cannot push an invalid value at a provider — each
// provider SDK rejects a bad effort value with a 400.
//
// Providers map the resolved decision to their own parameter shape themselves;
// this module deliberately knows nothing about `thinking_level` vs
// `reasoning_effort` vs `output_config`.

/**
 * @typedef {Object} ResolvedReasoning
 * @property {boolean}      supported — model can think at all
 * @property {boolean}      enabled   — think on this request
 * @property {string|null}  effort    — validated level, or null when the model
 *                                      exposes no dial (Claude Haiku 4.5)
 */

/** A model that declares no `reasoning` block cannot think. */
const supportsReasoning = (modelConfig) => Boolean(modelConfig?.reasoning);

/**
 * Resolve a request's thinking choice against what the model actually accepts.
 *
 * @param {object} modelConfig  entry from config/models.js
 * @param {{thinkingEnabled?: boolean, reasoningEffort?: string|null}} [request]
 * @returns {ResolvedReasoning}
 */
const resolveReasoning = (modelConfig, request = {}) => {
  const capability = modelConfig?.reasoning;
  if (!capability) return { supported: false, enabled: false, effort: null };

  const levels = Array.isArray(capability.levels) ? capability.levels : [];

  // Gemini has no off switch: the floor level still reasons. Honour the
  // capability rather than the request so we never send a disable the API
  // rejects — the UI shows this as a locked-on toggle.
  //
  // Otherwise an explicit boolean wins, and a request that says nothing falls
  // back to the model's default. That fallback is what makes a bare API call
  // match what the UI would have sent.
  //
  // The default is OFF: reasoning tokens bill as output, so it is opt-in. A
  // model has to say `enabledByDefault: true` to start on — either because the
  // provider cannot turn it off anyway, or because the model's reasoning path
  // is the reason it was chosen (mistral-small, the app's default).
  const enabled = capability.canDisable === false
    ? true
    : (typeof request.thinkingEnabled === 'boolean'
        ? request.thinkingEnabled
        : capability.enabledByDefault === true);

  if (!enabled) return { supported: true, enabled: false, effort: null };

  // No dial on this model — thinking is on, there is nothing to pick.
  if (levels.length === 0) return { supported: true, enabled: true, effort: null };

  const requested = request.reasoningEffort;
  const effort = levels.includes(requested)
    ? requested
    : (levels.includes(capability.default) ? capability.default : levels[levels.length - 1]);

  return { supported: true, enabled: true, effort };
};

/**
 * The capability shape sent to the client so it can build the level submenu and
 * decide whether to grey the Thinking button out. Never includes the API key or
 * any other server-only field.
 *
 * @returns {{levels: string[], default: string|null, canDisable: boolean,
 *            enabledByDefault: boolean, label: string}|null}
 */
const describeReasoning = (modelConfig) => {
  if (!supportsReasoning(modelConfig)) return null;
  const { levels, default: defaultLevel, canDisable, enabledByDefault, label } = modelConfig.reasoning;
  return {
    levels: Array.isArray(levels) ? levels : [],
    default: defaultLevel ?? null,
    canDisable: canDisable !== false,
    // The state the toggle starts in. A model with no off switch is always on,
    // so report that rather than the unused flag.
    enabledByDefault: canDisable === false ? true : enabledByDefault === true,
    // Anthropic's Haiku calls this "extended thinking"; most providers just
    // say thinking. Surfaced so tooltips can use the provider's own word.
    label: label || 'Thinking',
  };
};

module.exports = { resolveReasoning, describeReasoning, supportsReasoning };
