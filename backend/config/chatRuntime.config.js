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

const CHAT_MAX_DB_QUERIES = parseInteger('CHAT_MAX_DB_QUERIES', 12, 1, 100);
const CHAT_MAX_CONSECUTIVE_ZERO_RESULTS = parseInteger('CHAT_MAX_CONSECUTIVE_ZERO_RESULTS', 4, 1, 20);
const CHAT_TOOL_RESERVE_RATIO = parseFloatNumber('CHAT_TOOL_RESERVE_RATIO', 0.15, 0.05, 0.6);
const CHAT_SEMANTIC_CACHE_THRESHOLD = parseFloatNumber('CHAT_SEMANTIC_CACHE_THRESHOLD', 0.92, 0, 1);

module.exports = {
  CHAT_MAX_DB_QUERIES,
  CHAT_MAX_CONSECUTIVE_ZERO_RESULTS,
  CHAT_TOOL_RESERVE_RATIO,
  CHAT_SEMANTIC_CACHE_THRESHOLD,
};
