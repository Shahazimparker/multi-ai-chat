// ============================================================
// FILE: backend/services/queryTransform.service.js
// PURPOSE: Rewrite a user question into better retrieval queries.
//
//   Retrieval embeds the question and compares it against passages, but a
//   question and its answer rarely share vocabulary. "How do I make a diamond
//   box?" and "style=shape=mxgraph.flowchart.decision" are the same topic in
//   different languages, and cosine similarity does not bridge that gap.
//
//   Two independent techniques address it, and this module implements both:
//
//   MULTI-QUERY  Ask a cheap model for several alternate phrasings, retrieve
//                for each, fuse the candidate lists by rank. Cheap, low-risk,
//                and it composes with the RRF fusion already used for the
//                dense/sparse passes.
//
//   HyDE         Ask a model to write a hypothetical ANSWER, then embed that
//                instead of the question, because a hypothetical answer sits
//                far closer to a real passage in vector space than a question
//                does. Stronger on hard queries, but it costs a full
//                generation per turn and a confidently wrong hypothesis
//                drags retrieval with it — so it stays opt-in.
//
//   Both degrade to the original query on any failure. A rewriter outage must
//   never be able to break retrieval.
// ============================================================

// Namespace import, not destructured: the binding must stay late-bound so
// tests can stub it. A destructured copy is captured at require time and no
// spy can reach it — which silently turns unit tests into live API calls.
const dispatcher = require('./ai/dispatcher.service');
const { estimateTokens } = require('./tokenBudget.service');

// Deliberately small and cheap: this runs before every knowledge-base search,
// so a slow or expensive model here is felt on every single message.
// Built per call, not captured at module load. Reading process.env once at
// require time bakes in whatever existed before dotenv ran, and leaves the key
// impossible to rotate or clear afterwards.
// Ordered fallback chain. Unlike embeddings, a rewriter has NO compatibility
// constraint — any capable model produces usable output — so failover here is
// free and can cross providers freely.
//
// Rate limits are the expected failure, not the exceptional one: this fires on
// every knowledge-base search, so a busy period on one cheap model would
// otherwise silently disable expansion for everyone at once.
const transformChain = () => {
  const preferred = process.env.QUERY_TRANSFORM_MODEL;
  const chain = [
    ...(preferred ? [{ provider: 'openrouter', model: preferred, apiKey: process.env.OPENROUTER_API_KEY }] : []),
    { provider: 'openrouter', model: 'google/gemini-2.5-flash-lite', apiKey: process.env.OPENROUTER_API_KEY },
    { provider: 'openrouter', model: 'google/gemini-3.1-flash-lite', apiKey: process.env.OPENROUTER_API_KEY },
    // Different provider entirely, so an OpenRouter-wide outage or account
    // limit does not take the whole chain down with it.
    { provider: 'gemini', model: 'gemini-2.5-flash-lite', apiKey: process.env.GEMINI_SUMMARY_API_KEY || process.env.GEMINI_API_KEY },
    { provider: 'mistral', model: 'mistral-small-latest', apiKey: process.env.MISTRAL_SUMMARY_API_KEY || process.env.MISTRAL_API_KEY },
  ];

  // Drop unconfigured entries, and de-duplicate when QUERY_TRANSFORM_MODEL
  // names something already in the list.
  const seen = new Set();
  return chain.filter((c) => {
    if (!c.apiKey) return false;
    const key = `${c.provider}:${c.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// First configured entry — what a single-shot caller would use.
const transformModel = () => transformChain()[0] || {
  provider: 'openrouter',
  model: 'google/gemini-2.5-flash-lite',
  apiKey: process.env.OPENROUTER_API_KEY,
};

const isRateLimited = (err) => {
  const status = err?.response?.status || err?.status;
  return status === 429 || /\b429\b|rate.?limit|quota|too many requests/i.test(String(err?.message || ''));
};

/**
 * Run one prompt through the chain, moving to the next model on any failure.
 * Returns null if every configured model failed — callers degrade from there.
 */
const dispatchWithFallback = async (prompt, signal, label) => {
  const chain = transformChain();
  let lastError = null;

  for (const cfg of chain) {
    try {
      const result = await dispatcher.dispatchToAI(cfg, [{ role: 'user', content: prompt }], signal);
      if (cfg !== chain[0]) {
        console.warn(`[QueryTransform] ${label} served by fallback "${cfg.provider}/${cfg.model}".`);
      }
      return result;
    } catch (err) {
      if (err?.name === 'AbortError' || err?.name === 'CanceledError') throw err;
      lastError = err;
      const reason = isRateLimited(err) ? 'rate limited' : err.message;
      console.warn(`[QueryTransform] ${label} via "${cfg.provider}/${cfg.model}" failed (${reason}); trying next.`);
    }
  }

  if (lastError) throw lastError;
  return null;
};

// A query long enough to already carry plenty of retrieval signal gains little
// from rewriting, and rewriting it costs the most tokens.
const MAX_TRANSFORMABLE_CHARS = 600;

const isConfigured = () => Boolean(transformModel().apiKey);

/**
 * Strip list markers, quotes and numbering from a model's line-per-item output.
 */
const cleanLine = (line) => String(line || '')
  .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
  .replace(/^["'`]+|["'`]+$/g, '')
  .trim();

const parseLines = (text, limit) => {
  const lines = String(text || '')
    .split('\n')
    .map(cleanLine)
    .filter((l) => l.length > 2 && l.length < 300);

  // Dedupe case-insensitively; near-identical rewrites waste a retrieval pass.
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= limit) break;
  }
  return out;
};

/**
 * expandQuery — produce alternate phrasings of a question.
 *
 * Returns the ORIGINAL query first, always. Retrieval must never lose the
 * user's actual wording just because a rewriter had an opinion about it.
 *
 * `domainHint` is not optional in spirit. Without knowing what corpus it is
 * rewriting for, the model resolves ambiguity by everyday word frequency: asked
 * to expand "how do I make a diamond box?" it produces "diamond box
 * manufacturing" and "diamond box construction", which retrieve noise from a
 * diagramming reference. Naming the documents anchors it to the right domain.
 *
 * @param {string} query
 * @param {{ count?: number, signal?: AbortSignal, domainHint?: string }} options
 * @returns {Promise<{ queries: string[], tokensUsed: number, expanded: boolean }>}
 */
const expandQuery = async (query, options = {}) => {
  const { count = 3, signal = null, domainHint = '' } = options;
  const original = String(query || '').trim();

  if (!original || !isConfigured() || original.length > MAX_TRANSFORMABLE_CHARS) {
    return { queries: [original].filter(Boolean), tokensUsed: 0, expanded: false };
  }

  const prompt = [
    `Rewrite the search query below into ${count} alternative phrasings for a document search.`,
    '',
    ...(domainHint ? [`The search runs over these documents: ${domainHint}`, 'Stay within that subject matter — do not reinterpret the query in an unrelated everyday sense.', ''] : []),
    'Rules:',
    '- Each rewrite must be a standalone search query, not a question to the user.',
    '- Vary the vocabulary: use synonyms, domain terms, and the wording a DOCUMENT would use rather than the wording a person asks with.',
    '- Preserve any exact identifiers, error codes, product names or version numbers verbatim.',
    '- Output one query per line. No numbering, no commentary, no blank lines.',
    '',
    `Query: ${original}`,
  ].join('\n');

  try {
    const result = await dispatchWithFallback(prompt, signal, 'expansion');

    const variants = parseLines(result?.text, count)
      .filter((v) => v.toLowerCase() !== original.toLowerCase());

    if (variants.length === 0) {
      return { queries: [original], tokensUsed: result?.tokensUsed || 0, expanded: false };
    }

    console.log(`[QueryTransform] Expanded into ${variants.length} variant(s): ${variants.map((v) => `"${v.slice(0, 40)}"`).join(', ')}`);
    return {
      queries: [original, ...variants],
      tokensUsed: result?.tokensUsed || estimateTokens(prompt),
      expanded: true,
    };
  } catch (err) {
    if (err?.name === 'AbortError' || err?.name === 'CanceledError') throw err;
    // Retrieval still works on the original query.
    console.warn('[QueryTransform] Expansion failed, using original query:', err.message);
    return { queries: [original], tokensUsed: 0, expanded: false };
  }
};

/**
 * generateHypotheticalAnswer — HyDE.
 *
 * The returned text is a fabrication and must ONLY ever be used as an
 * embedding input. It must never reach the user or the answering model as
 * context: it is invented, unsourced, and frequently wrong in its specifics —
 * which does not matter for locating real passages, and matters enormously
 * for anything else.
 *
 * @param {string} query
 * @param {{ signal?: AbortSignal, domainHint?: string }} options
 * @returns {Promise<{ hypothetical: string|null, tokensUsed: number }>}
 */
const generateHypotheticalAnswer = async (query, options = {}) => {
  const { signal = null, domainHint = '' } = options;
  const original = String(query || '').trim();

  if (!original || !isConfigured() || original.length > MAX_TRANSFORMABLE_CHARS) {
    return { hypothetical: null, tokensUsed: 0 };
  }

  const prompt = [
    'Write a short passage that would plausibly appear in a reference document answering the question below.',
    '',
    ...(domainHint ? [`The reference documents are: ${domainHint}`, 'Write as if from those documents specifically.', ''] : []),
    'Rules:',
    '- Write it as documentation prose, not as a reply to a person.',
    '- 2-4 sentences. No preamble, no hedging, no "I".',
    '- Use the concrete vocabulary such a document would use.',
    '- It is fine to invent plausible specifics; this text is only used to locate real documents.',
    '',
    `Question: ${original}`,
  ].join('\n');

  try {
    const result = await dispatchWithFallback(prompt, signal, 'HyDE');

    const hypothetical = String(result?.text || '').trim();
    if (!hypothetical) return { hypothetical: null, tokensUsed: result?.tokensUsed || 0 };

    console.log(`[QueryTransform] HyDE hypothesis (${hypothetical.length} chars): "${hypothetical.slice(0, 60)}..."`);
    return { hypothetical, tokensUsed: result?.tokensUsed || estimateTokens(prompt) };
  } catch (err) {
    if (err?.name === 'AbortError' || err?.name === 'CanceledError') throw err;
    console.warn('[QueryTransform] HyDE failed, using original query:', err.message);
    return { hypothetical: null, tokensUsed: 0 };
  }
};

module.exports = {
  expandQuery,
  generateHypotheticalAnswer,
  isConfigured,
  parseLines,
  transformModel,
  transformChain,
};
