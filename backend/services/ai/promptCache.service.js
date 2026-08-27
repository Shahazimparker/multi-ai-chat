// ============================================================
// FILE: backend/services/ai/promptCache.service.js
// PURPOSE: One place that understands every provider's prompt-cache dialect.
// ============================================================
//
// Prompt caching is already ON for most of the providers here — OpenAI, DeepSeek
// and Gemini cache eligible prefixes automatically, with no request parameter to
// set. What was missing is that nothing read the result back, so the saving was
// invisible: DeepSeek reports cache hits in `prompt_cache_hit_tokens`, and the
// adapters only ever read `total_tokens`. A DeepSeek cache hit costs $0.014 per
// million against $0.14 uncached, so that is a 10x saving nobody could see,
// measure, or notice regressing.
//
// The field names disagree across providers for the same concept:
//
//   Anthropic  usage.cache_creation_input_tokens / cache_read_input_tokens
//   OpenAI     usage.prompt_tokens_details.cached_tokens        (reads only)
//   DeepSeek   usage.prompt_cache_hit_tokens / prompt_cache_miss_tokens
//   Gemini     usageMetadata.cachedContentTokenCount            (reads only)
//
// Reading the wrong dialect fails silently rather than throwing — which is how
// openai.service.js came to look for Anthropic's field names and report a flat
// zero forever. Normalising in one place is what stops that recurring.

// Providers that only ever report cache READS have no write metric to give: for
// them a cached prefix costs nothing extra to create, so there is no cache-write
// line to bill and `cacheCreationTokens` stays 0 by design, not by omission.

/**
 * Normalises a provider `usage` object into the shape the pipeline bills on.
 *
 * @param {object} usage - the raw provider usage block
 * @returns {{cacheCreationTokens:number, cacheReadTokens:number, cacheHit:boolean}}
 */
const extractCacheUsage = (usage) => {
  const empty = { cacheCreationTokens: 0, cacheReadTokens: 0, cacheHit: false };
  if (!usage || typeof usage !== 'object') return empty;

  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  // Anthropic is the only dialect that separates writes from reads.
  const write = num(usage.cache_creation_input_tokens);

  const read = num(usage.cache_read_input_tokens)
    || num(usage.prompt_tokens_details?.cached_tokens)
    || num(usage.promptTokensDetails?.cachedTokens)
    || num(usage.prompt_cache_hit_tokens)
    || num(usage.cachedContentTokenCount)
    || num(usage.cached_tokens);

  return {
    cacheCreationTokens: write,
    cacheReadTokens: read,
    cacheHit: read > 0,
  };
};

/**
 * Merges normalised cache usage into an adapter's return value.
 *
 * Adapters differ enough in shape that a spread helper keeps the wiring to one
 * line each and makes it obvious when one has been missed.
 */
const withCacheUsage = (result, usage) => ({
  ...result,
  ...extractCacheUsage(usage),
});

// OpenAI routes a request to a cache-bearing backend using a hash of
// `prompt_cache_key` plus the prompt head, and recommends setting it explicitly
// from GPT-5.6 on. Keying by conversation is what we want: every turn of one
// chat shares a prefix and should land on the same backend. Keying by user
// would spread one conversation across backends; keying globally would push far
// more than the ~15 requests/minute per key OpenAI suggests.
const buildPromptCacheKey = (topicId, userId) => {
  const scope = topicId || userId;
  return scope ? `multiaichat:topic:${scope}` : undefined;
};

// Anthropic silently declines to cache a prefix below this and returns no error,
// which is why the app's existing breakpoint on a ~959-token system block was a
// no-op. Opus/Sonnet are 1024; Haiku models are higher, so the conservative
// figure is used to decide whether a breakpoint is worth writing at all.
const ANTHROPIC_MIN_CACHEABLE_TOKENS = 1024;

const { ANTHROPIC_CACHE_TTL } = require('../../config/chatRuntime.config');

/**
 * The `cache_control` object every Anthropic breakpoint uses.
 *
 * A single shared TTL also satisfies Anthropic's ordering rule — entries with a
 * longer TTL must appear before shorter ones — which a mix of 1h and 5m
 * breakpoints could violate depending on where they land.
 */
const anthropicCacheControl = () => (
  ANTHROPIC_CACHE_TTL === '1h'
    ? { type: 'ephemeral', ttl: '1h' }
    : { type: 'ephemeral' }
);
const ANTHROPIC_MAX_BREAKPOINTS = 4;

/**
 * Puts an Anthropic cache breakpoint at the end of the conversation history.
 *
 * Anthropic takes `system` as its own top-level field, so a breakpoint there can
 * only ever cache the system prompt — ~959 tokens in this app, under the 1024
 * floor, which is why caching never engaged. The conversation history lives in
 * `messages`, is append-only, and is by far the largest stable region, so the
 * breakpoint that actually pays goes on its last entry: everything before it
 * (system + every prior turn) is then served from cache.
 *
 * This only works because retrieved context now travels with the current
 * question instead of ahead of the history — see chatPipeline's assembly. With
 * anything volatile sitting earlier the prefix would differ every turn and the
 * write would never be read back.
 *
 * Mutates nothing; returns a new array when a breakpoint was placed.
 *
 * @param {Array} chatMessages   - non-system messages, current turn last
 * @param {number} prefixTokens  - estimated tokens in system + history
 * @returns {Array}
 */
const applyAnthropicHistoryBreakpoint = (chatMessages, prefixTokens) => {
  // Needs at least one history turn before the current one to be worth caching.
  if (!Array.isArray(chatMessages) || chatMessages.length < 2) return chatMessages;
  if (prefixTokens < ANTHROPIC_MIN_CACHEABLE_TOKENS) return chatMessages;

  const idx = chatMessages.length - 2; // last message before the current turn
  const target = chatMessages[idx];
  if (!target) return chatMessages;

  const out = chatMessages.slice();
  const marker = { type: 'text', cache_control: anthropicCacheControl() };

  if (Array.isArray(target.content)) {
    const parts = target.content.slice();
    const lastIdx = parts.length - 1;
    if (lastIdx < 0) return chatMessages;
    parts[lastIdx] = { ...parts[lastIdx], cache_control: marker.cache_control };
    out[idx] = { ...target, content: parts };
  } else {
    // A string turn has to become a content block to carry the breakpoint.
    out[idx] = {
      ...target,
      content: [{ type: 'text', text: String(target.content || ''), cache_control: marker.cache_control }],
    };
  }
  return out;
};

/**
 * Formats cache usage for the pipeline log.
 *
 * Reported as a share of the prompt because the absolute numbers mean nothing
 * without the denominator — 8k cached tokens is excellent on a 9k prompt and
 * negligible on a 200k one.
 */
const describeCacheUsage = ({ cacheCreationTokens = 0, cacheReadTokens = 0 }, promptTokens = 0) => {
  if (cacheReadTokens === 0 && cacheCreationTokens === 0) {
    return 'cache: no hit (prefix changed, below provider minimum, or expired)';
  }
  const parts = [];
  if (cacheReadTokens > 0) {
    const pct = promptTokens > 0 ? Math.round((cacheReadTokens / promptTokens) * 100) : 0;
    parts.push(`read ${cacheReadTokens} tok (${pct}% of prompt)`);
  }
  if (cacheCreationTokens > 0) parts.push(`wrote ${cacheCreationTokens} tok`);
  return `cache: ${parts.join(', ')}`;
};

module.exports = {
  anthropicCacheControl,
  applyAnthropicHistoryBreakpoint,
  extractCacheUsage,
  withCacheUsage,
  buildPromptCacheKey,
  describeCacheUsage,
  ANTHROPIC_MIN_CACHEABLE_TOKENS,
  ANTHROPIC_MAX_BREAKPOINTS,
};
