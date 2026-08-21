const parseInteger = (name, fallback, min, max) => {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const parseFloatNumber = (name, fallback, min, max) => {
  const raw = process.env[name];
  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const parseBoolean = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return String(raw).toLowerCase() === 'true';
};

// OrchestratorBrain runs a planning layer before the provider call: a routing
// decision (1-2 LLM calls) plus a SmartAgent plan (1 more). None of those
// outputs feed the reply — the routing gate they fed was retired — so it costs
// latency and provider spend on every message for no change in output.
// Off by default; set ENABLE_ORCHESTRATOR_BRAIN=true to opt back in, in which
// case its tokens are counted into the user's billable total.
const ENABLE_ORCHESTRATOR_BRAIN = parseBoolean('ENABLE_ORCHESTRATOR_BRAIN', false);

// Vercel kills an invocation at the project's Function Max Duration (300s here)
// with no warning — the SSE stream just stops mid-reply and the user sees a
// truncated answer. The tool loop bounds rounds but not wall-clock time, so a
// slow provider or several tool rounds can run past that. This budget stops the
// loop from starting another round once it is exceeded, leaving headroom for the
// persistence and analytics steps that still have to run after the loop.
const CHAT_TIME_BUDGET_MS = parseInteger('CHAT_TIME_BUDGET_MS', 240000, 10000, 3600000);

// No provider SDK in services/ai/* sets its own request timeout, so a hung
// upstream call blocks until the platform kills the whole invocation. This caps
// a single provider call: total wall-clock for non-streaming, idle time between
// chunks for streaming (a healthy long stream keeps resetting it). Set to 0 to
// disable. Keep it below CHAT_TIME_BUDGET_MS so one bad call cannot spend the
// entire turn's budget.
const AI_CALL_TIMEOUT_MS = parseInteger('AI_CALL_TIMEOUT_MS', 120000, 0, 600000);

const CHAT_MAX_DB_QUERIES = parseInteger('CHAT_MAX_DB_QUERIES', 12, 1, 100);
const CHAT_MAX_CONSECUTIVE_ZERO_RESULTS = parseInteger('CHAT_MAX_CONSECUTIVE_ZERO_RESULTS', 4, 1, 20);
const CHAT_TOOL_RESERVE_RATIO = parseFloatNumber('CHAT_TOOL_RESERVE_RATIO', 0.15, 0.05, 0.6);
const CHAT_SEMANTIC_CACHE_THRESHOLD = parseFloatNumber('CHAT_SEMANTIC_CACHE_THRESHOLD', 0.92, 0, 1);

// Cross-encoder reranking of knowledge-base retrieval results. Embedding
// similarity encodes the query and each chunk separately; a cross-encoder reads
// the pair together, so it orders a shortlist far better than cosine can. It
// costs one extra API call (~100-200ms) per knowledge-base search.
// Enabled whenever COHERE_API_KEY is present; set RAG_RERANK_ENABLED=false to
// force it off without removing the key.
const RAG_RERANK_ENABLED = parseBoolean('RAG_RERANK_ENABLED', true);
const RAG_RERANK_MODEL = process.env.COHERE_RERANK_MODEL || 'rerank-v3.5';
const RAG_RERANK_TIMEOUT_MS = parseInteger('RAG_RERANK_TIMEOUT_MS', 8000, 1000, 30000);

// How many candidates to pull from pgvector before reranking. Oversampling is
// what makes reranking pay: the cross-encoder can promote a chunk the embedder
// ranked 20th, but only if that chunk is in the candidate set at all.
const RAG_RERANK_CANDIDATE_MULTIPLIER = parseInteger('RAG_RERANK_CANDIDATE_MULTIPLIER', 5, 2, 20);

// Minimum cross-encoder relevance for a passage to be presented as a source.
// Cohere's relevance_score is calibrated 0-1, so unlike the old hybrid score
// this threshold means something. Passages below it are dropped rather than
// dressed up as verified references.
const RAG_RERANK_MIN_RELEVANCE = parseFloatNumber('RAG_RERANK_MIN_RELEVANCE', 0.30, 0, 1);

// Query expansion (multi-query). A question and the passage answering it
// rarely share vocabulary; asking a cheap model for alternate phrasings and
// fusing the retrieval results covers more of that gap. Costs one small
// generation per knowledge-base search.
const RAG_QUERY_EXPANSION_ENABLED = parseBoolean('RAG_QUERY_EXPANSION_ENABLED', true);
const RAG_QUERY_EXPANSION_COUNT = parseInteger('RAG_QUERY_EXPANSION_COUNT', 3, 1, 6);

// HyDE: embed a hypothetical ANSWER instead of the question, because an answer
// sits closer to a real passage in vector space. Stronger than multi-query on
// hard questions, but it adds a full generation per turn and a confidently
// wrong hypothesis pulls retrieval with it. Off by default; opt in per
// deployment once you have measured it on your own corpus.
const RAG_HYDE_ENABLED = parseBoolean('RAG_HYDE_ENABLED', false);

// RAPTOR summary nodes are ranked alongside leaf chunks. A summary can tie or
// beat the passage that actually contains a term, which is wrong for exact
// lookups: synthesis should not displace primary text at equal relevance.
// Subtracted from a summary's score to break those ties toward real passages.
// Set 0 to rank summaries and leaves identically.
const RAPTOR_SUMMARY_PENALTY = parseFloatNumber('RAPTOR_SUMMARY_PENALTY', 0.05, 0, 0.5);

// Graph retrieval. Contributes a third candidate list to the same RRF fusion
// as the dense and sparse passes, so it is another opinion about which chunks
// matter rather than a separate pipeline. Contributes nothing when the graph
// is empty or the migration has not been applied.
const GRAPHRAG_ENABLED = parseBoolean('GRAPHRAG_ENABLED', true);
// Hops out from the entities the query names. 1 covers "A relates to B"; more
// pulls in loosely-connected material and dilutes the candidate set.
const GRAPHRAG_MAX_HOPS = parseInteger('GRAPHRAG_MAX_HOPS', 1, 0, 3);

// Temporal grounding. The zone used when a request carries none and the user
// has saved no preference — deliberately not the container's local zone, which
// is UTC on every serverless host and would silently answer a Mumbai user in
// London time. Set it to the deployment's primary business timezone.
const DEFAULT_TIMEZONE = process.env.APP_DEFAULT_TIMEZONE || 'UTC';

// How finely the injected "now" is rendered. Prompt caching keys on an exact
// prefix match, so a second-precision clock in the prompt is a guaranteed cache
// miss on every turn. One minute is well inside what any chat answer needs.
// Raise it to 300000 (5 min) for a higher cache hit rate on chatty workloads.
const TEMPORAL_PRECISION_MS = parseInteger('TEMPORAL_PRECISION_MS', 60000, 1000, 3600000);

module.exports = {
  DEFAULT_TIMEZONE,
  TEMPORAL_PRECISION_MS,
  ENABLE_ORCHESTRATOR_BRAIN,
  GRAPHRAG_ENABLED,
  GRAPHRAG_MAX_HOPS,
  RAPTOR_SUMMARY_PENALTY,
  RAG_QUERY_EXPANSION_ENABLED,
  RAG_QUERY_EXPANSION_COUNT,
  RAG_HYDE_ENABLED,
  RAG_RERANK_ENABLED,
  RAG_RERANK_MODEL,
  RAG_RERANK_TIMEOUT_MS,
  RAG_RERANK_CANDIDATE_MULTIPLIER,
  RAG_RERANK_MIN_RELEVANCE,
  CHAT_TIME_BUDGET_MS,
  AI_CALL_TIMEOUT_MS,
  CHAT_MAX_DB_QUERIES,
  CHAT_MAX_CONSECUTIVE_ZERO_RESULTS,
  CHAT_TOOL_RESERVE_RATIO,
  CHAT_SEMANTIC_CACHE_THRESHOLD,
};
