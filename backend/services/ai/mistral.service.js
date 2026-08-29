// ============================================================
// FILE: backend/services/ai/mistral.service.js
// PURPOSE: Calls Mistral AI API + Mistral Embeddings
// ============================================================

const axios = require('axios');
const { extractCacheUsage } = require('./promptCache.service');
const { resolveReasoning } = require('./reasoning.service');
const { outputCapFor } = require('../contextWindow.service');

const MISTRAL_CHAT_URL = 'https://api.mistral.ai/v1/chat/completions';

// `max_tokens` and the prompt budget are two halves of one contract: the
// context fitter holds back exactly what we send here. Both read
// config/models.js `maxOutputTokens` through outputCapFor, so raising a model's
// answer budget in one place moves both. Omitting max_tokens entirely (as this
// file briefly did) is the failure mode that matters — Mistral then treats the
// answer as unbounded, and on mistral-small's 50,000 free TPM a single runaway
// reasoning trace can consume the whole minute.
//
// Internal chains (summary, RAPTOR, GraphRAG, vision, queryTransform) build
// bare {provider, model, apiKey} configs with no window at all. Those are not
// registry entries and must not inherit outputCapFor's 8000-token default
// window, which would reserve 2000 and quietly truncate a RAPTOR summary or a
// GraphRAG extraction that used to get 16000.
const BARE_CONFIG_MAX_OUTPUT = 16000;

const maxTokensFor = (modelConfig) => (
  modelConfig?.maxOutputTokens || modelConfig?.maxTokens
    ? outputCapFor(modelConfig)
    : BARE_CONFIG_MAX_OUTPUT
);

// Mistral's reasoning models return `content` as a list of chunks rather than a
// string. Two types exist (docs.mistral.ai/studio-api/conversations/reasoning):
//
//   ThinkChunk  type: "thinking"  — payload is `thinking`, itself a LIST of
//                                   TextChunks, not a string.
//   TextChunk   type: "text"      — payload is `text`, the actual answer.
//
// Both details are easy to get wrong and fail silently: matching "think" or
// "reasoning" (neither is ever sent) drops every trace on the floor, and
// reading `.text` off a ThinkChunk yields undefined because the text is nested
// one level down.
const THINK_CHUNK = 'thinking';

const thinkChunkText = (chunk) => {
  const inner = chunk?.thinking;
  if (Array.isArray(inner)) return inner.map((part) => part?.text || '').join('');
  return typeof inner === 'string' ? inner : '';
};

/**
 * Flattens one `content` value — string or chunk list — into answer text and
 * reasoning text. Shared by the streaming and non-streaming paths, which see
 * the same shapes and previously disagreed about them.
 */
const splitContent = (content) => {
  if (typeof content === 'string') return { text: content, reasoning: '' };
  if (!Array.isArray(content)) return { text: '', reasoning: '' };

  let text = '';
  let reasoning = '';
  for (const chunk of content) {
    if (typeof chunk === 'string') { text += chunk; continue; }
    if (chunk?.type === THINK_CHUNK) reasoning += thinkChunkText(chunk);
    else text += chunk?.text || '';
  }
  return { text, reasoning };
};

/**
 * Mistral accepts only "high" and "none" — not low/medium/max, which 400.
 *
 * "Off" sends "none" rather than omitting the field: mistral-small-latest is a
 * hybrid reasoning model, so an absent parameter inherits the model's own
 * default instead of asserting the user's choice.
 */
const reasoningParams = (decision) => {
  if (!decision.supported) return {};
  return { reasoning_effort: decision.enabled ? (decision.effort || 'high') : 'none' };
};

// Mistral prompt caching is NOT automatic: without `prompt_cache_key` the API
// simply does not cache, so this parameter is the difference between caching
// working and not existing at all. Cached tokens bill at ~10% of the normal
// input rate, the prefix minimum is only 64 tokens, and the cache lives an
// hour — which makes it the highest-value provider knob here, because
// mistral-medium is the app's default model.
const callMistral = async (modelName, apiKey, messages, signal = null, options = {}, modelConfig = null, reasoningRequest = {}) => {
  const decision = resolveReasoning(modelConfig, reasoningRequest);
  const response = await axios.post(
    MISTRAL_CHAT_URL,
    {
      model:       modelName,
      messages:    messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens:  maxTokensFor(modelConfig),
      temperature: 0.7,
      ...reasoningParams(decision),
      ...(options.promptCacheKey ? { prompt_cache_key: options.promptCacheKey } : {}),
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal,
    }
  );

  // With reasoning on, `content` is a chunk list. Returning it raw handed every
  // caller an array where it expected a string — and the RAG, summary, RAPTOR,
  // vision and query-transform paths all reach this function on
  // mistral-small-latest, so that would surface as five unrelated bugs.
  const { text, reasoning } = splitContent(response.data.choices[0]?.message?.content);
  const tokensUsed = response.data.usage?.total_tokens || 0;
  // Mistral reports cache reads under prompt_tokens_details.cached_tokens, the
  // OpenAI-compatible location. Omitting this left the non-streaming path
  // reporting `undefined` while the streaming path reported correctly.
  return {
    text,
    // Matches the streaming path's shape, and omitted when empty so callers
    // that never asked for reasoning see no new field.
    ...(reasoning ? { reasoning } : {}),
    tokensUsed,
    ...extractCacheUsage(response.data.usage),
  };
};

/**
 * Streaming variant for Mistral — consumes SSE stream via axios, yields text deltas.
 * @param {string} modelName
 * @param {string} apiKey
 * @param {Array} messages
 * @param {AbortSignal|null} signal
 * @param {(text: string) => void} onChunk
 * @returns {Promise<{text: string, tokensUsed: number}>}
 */
const callMistralStream = async (modelName, apiKey, messages, signal = null, onChunk, onReasoning, modelConfig = null, reasoningRequest = {}, options = {}) => {
  const decision = resolveReasoning(modelConfig, reasoningRequest);
  const response = await axios.post(
    MISTRAL_CHAT_URL,
    {
      model:       modelName,
      messages:    messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens:  maxTokensFor(modelConfig),
      temperature: 0.7,
      stream:      true,
      ...reasoningParams(decision),
      ...(options.promptCacheKey ? { prompt_cache_key: options.promptCacheKey } : {}),
      // Deliberately NO `stream_options: { include_usage: true }` here, unlike
      // the other OpenAI-compatible providers. Mistral validates its request
      // body strictly and rejects the field outright:
      //   422 extra_forbidden — "Extra inputs are not permitted"
      //   loc: ['body', 'stream_options', 'include_usage']
      // Sending it breaks Mistral streaming entirely. It is also unnecessary:
      // Mistral already puts usage on the final chunk by default, which the
      // reader below picks up.
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      signal,
      responseType: 'stream',
    }
  );

  return new Promise((resolve, reject) => {
    let fullText = '';
    let fullReasoning = '';
    let tokensUsed = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;
    let buffer = '';

    response.data.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const jsonStr = trimmed.slice(6);
        if (jsonStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(jsonStr);
          // delta.content changes shape mid-response: a chunk list while the
          // model thinks, one mixed list on the transition, then a plain string
          // for the answer. splitContent handles all three.
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            const { text, reasoning } = splitContent(delta);
            if (text) {
              fullText += text;
              if (onChunk) onChunk(text);
            }
            if (reasoning) {
              fullReasoning += reasoning;
              if (onReasoning) onReasoning(reasoning);
            }
          }

          // Fallback for the OpenAI-compatible location, in case Mistral ever
          // mirrors reasoning there. Never both — this is a different field
          // from delta.content, so it cannot double-count the chunk list above.
          const reasoningDelta = parsed.choices?.[0]?.delta?.reasoning_content || parsed.choices?.[0]?.delta?.reasoning;
          if (reasoningDelta && typeof reasoningDelta === 'string') {
            fullReasoning += reasoningDelta;
            if (onReasoning) onReasoning(reasoningDelta);
          }
          if (parsed.usage?.total_tokens) {
            tokensUsed = parsed.usage.total_tokens;
          }
          if (parsed.usage) {
            const c = extractCacheUsage(parsed.usage);
            if (c.cacheReadTokens || c.cacheCreationTokens) {
              cacheCreationTokens = c.cacheCreationTokens;
              cacheReadTokens = c.cacheReadTokens;
            }
          }
        } catch { /* skip malformed lines */ }
      }
    });

    response.data.on('end', () => {
      // `reasoning` matches groq.service.js so the pipeline persists a Mistral
      // thinking trace the same way it persists everyone else's.
      resolve({ text: fullText, reasoning: fullReasoning, tokensUsed, cacheCreationTokens, cacheReadTokens });
    });

    response.data.on('error', (err) => {
      reject(err);
    });

    if (signal) {
      signal.addEventListener('abort', () => {
        response.data.destroy();
        reject({ name: 'AbortError' });
      }, { once: true });
    }
  });
};

/**
 * embedWithMistral — generates embedding via Mistral API
 * NOW RETURNS { vector, tokensUsed } instead of just the vector array
 */
const embedWithMistral = async (text, apiKey) => {
  const response = await axios.post(
    'https://api.mistral.ai/v1/embeddings',
    {
      model: 'mistral-embed',
      input: [text],
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  let vector = response.data.data[0].embedding; // 1024 dims
  // Try to get actual token usage from API response
  const tokensUsed = response.data.usage?.prompt_tokens || 0;
  // Pad to 1536 to match Supabase pgvector column
  if (vector.length < 1536) {
    vector = [...vector, ...new Array(1536 - vector.length).fill(0)];
  }
  return { vector, tokensUsed };
};

module.exports = { callMistral, callMistralStream, embedWithMistral };