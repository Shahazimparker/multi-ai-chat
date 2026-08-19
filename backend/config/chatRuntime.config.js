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

module.exports = {
  ENABLE_ORCHESTRATOR_BRAIN,
  CHAT_TIME_BUDGET_MS,
  AI_CALL_TIMEOUT_MS,
  CHAT_MAX_DB_QUERIES,
  CHAT_MAX_CONSECUTIVE_ZERO_RESULTS,
  CHAT_TOOL_RESERVE_RATIO,
  CHAT_SEMANTIC_CACHE_THRESHOLD,
};
