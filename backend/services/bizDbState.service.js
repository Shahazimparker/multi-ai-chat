const { initBusinessDB } = require('./businessDb.service');
const {
  CHAT_MAX_DB_QUERIES,
  CHAT_MAX_CONSECUTIVE_ZERO_RESULTS,
  CHAT_TOOL_RESERVE_RATIO,
} = require('../config/chatRuntime.config');

const MAX_DB_QUERIES = CHAT_MAX_DB_QUERIES;
const MAX_CONSECUTIVE_ZERO_RESULTS = CHAT_MAX_CONSECUTIVE_ZERO_RESULTS;

let bizDbConnected = null;
let bizDbSchemaText = '';
let bizDbMinimalSchemaText = '';

const ensureBizDbInit = async () => {
  if (bizDbConnected === null) {
    const state = await initBusinessDB();
    bizDbConnected = state.connected;
    bizDbSchemaText = state.schemaText;
    bizDbMinimalSchemaText = state.minimalSchemaText;
  }
  return { bizDbConnected, bizDbSchemaText, bizDbMinimalSchemaText };
};

ensureBizDbInit().catch((err) => {
  console.warn('[BizDB] Module init deferred:', err.message);
});

const reserveToolLoopBudget = (promptBudget, reserveRatio = CHAT_TOOL_RESERVE_RATIO) => {
  const toolReserveTokens = Math.min(1400, Math.max(300, Math.floor(promptBudget.maxPromptTokens * reserveRatio)));
  const availableContextTokens = Math.max(900, promptBudget.maxPromptTokens - toolReserveTokens);
  const scale = Math.min(1, availableContextTokens / promptBudget.maxPromptTokens);

  return {
    ...promptBudget,
    toolReserveTokens,
    contextBudgetTokens: availableContextTokens,
    systemTokens: Math.max(100, Math.floor(promptBudget.systemTokens * scale)),
    historyTokens: Math.max(200, Math.floor(promptBudget.historyTokens * scale)),
    ragTokens: Math.max(200, Math.floor(promptBudget.ragTokens * scale)),
    fileTokens: Math.max(150, Math.floor(promptBudget.fileTokens * scale)),
    queryTokens: Math.max(120, Math.floor(promptBudget.queryTokens * scale)),
  };
};

const buildBizDbDirective = (effectiveDbOnly) => {
  const selectedSchema = effectiveDbOnly ? bizDbMinimalSchemaText : '';
  if (!bizDbConnected || !selectedSchema) return { selectedSchema, bizDbDirective: '' };

  const baseBizRules = `\n\n## Business Database Access\nYou have read-only access to a business database via [QUERY_DB] tool.\n\n${selectedSchema}`;

  const dbOnlyRules = baseBizRules + `\n\n🔒 ONLY DB MODE (ACTIVE - STRICT):\n- You MUST use [QUERY_DB] for ANY question that could involve data, facts, counts, lists, names, IDs, statuses, dates, amounts, or anything that might exist in the business database.\n- DEFAULT behavior: query the DB first. Do NOT answer from training data or memory.\n- ONLY skip [QUERY_DB] if the user message is a pure greeting ("hi", "hello", "thanks", "bye") or an explicit meta question about you (e.g., "what model are you?"). When in doubt — QUERY.\n- You CANNOT use your training data for business facts, numbers, names, or answers. ALWAYS query the DB.\n- There is NO RAG/cache. Every business query is live.\n- If [QUERY_DB] returns empty — say exactly "No data found in database." Do NOT invent fallback answers.\n- NEVER fabricate, guess, or estimate data. Only present what the DB returns.\n- NEVER call external APIs for business data.\n- NEVER show the SQL query text to the user — no \`\`\`sql blocks, no <SQL_QUERY> tags, no SELECT statements. Present ONLY the formatted results as tables/text.\n- Your FINAL answer must be plain prose + markdown tables. No SQL anywhere.\n- Always run the query with concise and proper syntax — never show placeholder or sample data before querying.\n- If you are unsure which table to use, call [GET_SCHEMA:table1,table2] first, then [QUERY_DB].\n- Format results as tables for structured data.`;
  const relaxedBizRules = baseBizRules + `\n\n📋 RULES:\n- When the user asks about business data — query the DB using [QUERY_DB].\n- You may use your training knowledge alongside DB results.\n- If [QUERY_DB] returns empty, say "No data found in database."\n- NEVER fabricate data that should come from the DB.\n- NEVER call external APIs for business data.\n- Format results as tables for structured data.`;

  return {
    selectedSchema,
    bizDbDirective: effectiveDbOnly ? dbOnlyRules : relaxedBizRules,
  };
};

module.exports = {
  MAX_DB_QUERIES,
  MAX_CONSECUTIVE_ZERO_RESULTS,
  ensureBizDbInit,
  reserveToolLoopBudget,
  buildBizDbDirective,
  get bizDbConnected() { return bizDbConnected; },
  get bizDbSchemaText() { return bizDbSchemaText; },
  get bizDbMinimalSchemaText() { return bizDbMinimalSchemaText; },
};
