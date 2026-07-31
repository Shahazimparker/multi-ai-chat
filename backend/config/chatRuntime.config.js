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

const CHAT_MAX_DB_QUERIES = parseInteger('CHAT_MAX_DB_QUERIES', 12, 1, 100);
const CHAT_MAX_CONSECUTIVE_ZERO_RESULTS = parseInteger('CHAT_MAX_CONSECUTIVE_ZERO_RESULTS', 4, 1, 20);
const CHAT_TOOL_RESERVE_RATIO = parseFloatNumber('CHAT_TOOL_RESERVE_RATIO', 0.15, 0.05, 0.6);
const CHAT_SEMANTIC_CACHE_THRESHOLD = parseFloatNumber('CHAT_SEMANTIC_CACHE_THRESHOLD', 0.92, 0, 1);

module.exports = {
  ENABLE_ORCHESTRATOR_BRAIN,
  CHAT_MAX_DB_QUERIES,
  CHAT_MAX_CONSECUTIVE_ZERO_RESULTS,
  CHAT_TOOL_RESERVE_RATIO,
  CHAT_SEMANTIC_CACHE_THRESHOLD,
};
