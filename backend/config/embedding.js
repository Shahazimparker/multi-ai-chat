// ============================================================
// FILE: backend/config/embedding.js
// PURPOSE: Single source of truth for embedding providers.
//
//   A stored vector is only comparable to a query vector when both came from
//   the SAME MODEL. Provider is the wrong unit for that: 'openrouter' and
//   'openai' both serve text-embedding-3-small, so their vectors are the same
//   numbers and are freely interchangeable. 'gemini' and 'mistral' are not.
//
//   So every vector is tagged with its SPACE (the model identity), not its
//   provider, and search filters on space. Two consequences fall out:
//     - openrouter can fail over to openai with no re-index, because the
//       fallback lands in the space the stored rows are already tagged with.
//     - a gemini-indexed row can never be scored against an openai query
//       vector, which is the silent-garbage case this file exists to prevent.
// ============================================================

/**
 * Native dimensionality per space. Vectors shorter than the pgvector column
 * width (1536) are zero-padded at write time — padding is lossless for cosine
 * (the dot product and both norms are unchanged), so it costs storage, not
 * accuracy. `dims` is retained so a wrong-width vector can be detected.
 */
const SPACES = {
  'openai-te3-small': { dims: 1536 },
  'gemini-embed-001': { dims: 768 },
  'mistral-embed':    { dims: 1024 },
};

const VECTOR_COLUMN_DIMS = 1536;

/**
 * Provider → the space it produces, plus the env var that enables it.
 * `space` is what gets written to the database; `provider` is only ever a
 * routing detail.
 */
const PROVIDERS = {
  openrouter: { space: 'openai-te3-small', model: 'openai/text-embedding-3-small', envKey: 'OPENROUTER_API_KEY' },
  openai:     { space: 'openai-te3-small', model: 'text-embedding-3-small',        envKey: 'OPENAI_API_KEY' },
  gemini:     { space: 'gemini-embed-001', model: 'embedding-001',                 envKey: 'GEMINI_API_KEY' },
  mistral:    { space: 'mistral-embed',    model: 'mistral-embed',                 envKey: 'MISTRAL_API_KEY' },
};

const DEFAULT_PROVIDER = 'openrouter';

/** The space every row written before the space column existed belongs to. */
const LEGACY_SPACE = 'openai-te3-small';

const getProviderSpec = (provider) => PROVIDERS[provider] || PROVIDERS[DEFAULT_PROVIDER];

/** The space a provider writes into. Safe to call with unknown/undefined input. */
const spaceForProvider = (provider) => getProviderSpec(provider).space;

const hasCredentials = (provider) => {
  const spec = PROVIDERS[provider];
  return Boolean(spec && process.env[spec.envKey]);
};

/**
 * Ordered list of providers to try for a request, all of which write the SAME
 * space as `provider`. The requested provider goes first; same-space siblings
 * follow as failover. Providers with no API key configured are dropped.
 *
 * Cross-space failover is deliberately impossible here — falling back from
 * openrouter to gemini would write vectors that no existing row can be
 * compared against, which is exactly the corruption this module prevents.
 *
 * @param {string} provider
 * @returns {string[]} provider ids, possibly empty if nothing is configured
 */
const resolveProviderChain = (provider) => {
  const requested = PROVIDERS[provider] ? provider : DEFAULT_PROVIDER;
  const space = PROVIDERS[requested].space;

  const siblings = Object.keys(PROVIDERS)
    .filter((id) => id !== requested && PROVIDERS[id].space === space);

  return [requested, ...siblings].filter(hasCredentials);
};

/**
 * Zero-pad a native vector out to the pgvector column width.
 * Lossless for cosine similarity; see the note on SPACES above.
 */
const padVector = (vector) => {
  if (!Array.isArray(vector) || vector.length >= VECTOR_COLUMN_DIMS) return vector;
  return [...vector, ...new Array(VECTOR_COLUMN_DIMS - vector.length).fill(0)];
};

module.exports = {
  SPACES,
  PROVIDERS,
  DEFAULT_PROVIDER,
  LEGACY_SPACE,
  VECTOR_COLUMN_DIMS,
  getProviderSpec,
  spaceForProvider,
  hasCredentials,
  resolveProviderChain,
  padVector,
};
