// FILE: backend/services/tokenBudget.service.js
// PURPOSE: Lightweight prompt budgeting so RAG, files, and history cannot grow without bounds.

const supabase = require('../config/supabase');

// Prose tokenizes at roughly 4 characters per token. Dense structured text —
// stack traces, JSON, SAP short dumps, minified payloads — carries far more
// punctuation and long unsplittable identifiers, and lands nearer 3. Using the
// prose ratio for a log file undercounts it by a third, which is the one
// direction that matters once measurement is the safety mechanism.
const PROSE_CHARS_PER_TOKEN = 4;
const DENSE_CHARS_PER_TOKEN = 3;

// Share of non-alphanumeric, non-space characters above which text is treated
// as dense. Ordinary prose sits near 3-5% (spaces excluded); JSON and stack
// traces run well past 15%.
const DENSE_SYMBOL_RATIO = 0.15;

// Sampled rather than scanned: this runs over every message of every prompt,
// and an 18MB log must not be walked character by character to classify it.
const DENSITY_SAMPLE_CHARS = 4000;

// A provider-resized image costs on the order of a thousand tokens. Counting a
// multimodal content array by stringifying it yields "[object Object]" and
// scores it at ~5, so a vision turn used to be measured at almost nothing.
const IMAGE_PART_TOKENS = 1200;

const isDenseText = (str) => {
  const sample = str.length > DENSITY_SAMPLE_CHARS ? str.slice(0, DENSITY_SAMPLE_CHARS) : str;
  if (!sample) return false;
  let symbols = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    // space, tab, LF, CR
    if (code === 32 || code === 9 || code === 10 || code === 13) continue;
    const isAlnum = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    if (!isAlnum) symbols++;
  }
  return symbols / sample.length > DENSE_SYMBOL_RATIO;
};

/**
 * Estimate token count using a hybrid approach:
 * - Word-based: ~1.3 tokens per word (accurate for natural language)
 * - Char-based: 4 chars/token for prose, 3 for dense structured text
 * - Takes the MAX of the two, never the average.
 *
 * The max is the whole point. This number is what keeps an assembled prompt
 * under the model's window, so an overestimate costs a little unused headroom
 * while an underestimate costs the user their answer. The previous average
 * split the difference and inherited the downside of both.
 *
 * Handles multimodal content arrays, whose image parts a string-based estimate
 * would score at almost zero.
 */
const estimateTokens = (text = '') => {
  if (!text) return 0;

  if (Array.isArray(text)) {
    return text.reduce((sum, part) => {
      if (!part) return sum;
      if (typeof part === 'string') return sum + estimateTokens(part);
      if (part.type === 'text') return sum + estimateTokens(part.text || '');
      if (part.type === 'image_url' || part.type === 'image') return sum + IMAGE_PART_TOKENS;
      return sum + estimateTokens(part.text || '');
    }, 0);
  }

  const str = String(text).trim();
  if (!str) return 0;

  const charsPerToken = isDenseText(str) ? DENSE_CHARS_PER_TOKEN : PROSE_CHARS_PER_TOKEN;
  const charEstimate = Math.ceil(str.length / charsPerToken);
  const words = str.split(/\s+/).length;
  const wordEstimate = Math.ceil(words * 1.3);

  return Math.max(charEstimate, wordEstimate);
};

const CHARS_PER_TOKEN = PROSE_CHARS_PER_TOKEN; // kept for backward compatibility

/**
 * Cuts text down to roughly `maxTokens`.
 *
 * Uses the same density heuristic as estimateTokens so the two stay inverses of
 * each other. A fixed 4 chars per token here meant trimming a JSON log to "100
 * tokens" produced text the estimator then scored at 129 — the trim overshot
 * precisely on the dense content it is most often asked to handle, which is
 * fatal once trimming is the last thing standing between a prompt and the
 * model's ceiling.
 */
const trimTextByTokens = (text = '', maxTokens = 0) => {
  if (!text || maxTokens <= 0) return '';
  const str = String(text);
  const totalTokens = estimateTokens(str);
  if (totalTokens <= maxTokens) return str;

  // Self-calibrating: derive the chars-per-token rate from this very text
  // rather than assuming one. A fixed rate is wrong in both directions — 4
  // overshoots on JSON logs, and on prose full of short words the word-count
  // term dominates and 4 overshoots there too.
  const rate = str.length / Math.max(1, totalTokens);
  let maxChars = Math.max(0, Math.floor(maxTokens * rate) - 16);

  // The rate is an average and the head of a document can be denser than its
  // tail, so verify and shrink rather than trusting one division. Bounded to a
  // few passes; each one removes a tenth, so it converges quickly.
  let out = str.slice(0, maxChars).trim();
  for (let i = 0; i < 6 && estimateTokens(out) > maxTokens && maxChars > 0; i++) {
    maxChars = Math.floor(maxChars * 0.9);
    out = str.slice(0, maxChars).trim();
  }
  return `${out}...`;
};

const trimMessageContent = (message, maxTokens) => ({
  ...message,
  content: trimTextByTokens(message.content, maxTokens),
});

const estimateMessagesTokens = (messages = []) => (
  messages.reduce((sum, message) => sum + estimateTokens(message.content) + 4, 0)
);

const fitMessagesToBudget = (messages, maxPromptTokens) => {
  const result = [];
  let remaining = maxPromptTokens;

  for (const message of messages) {
    const estimated = estimateTokens(message.content) + 4;
    if (estimated <= remaining) {
      result.push(message);
      remaining -= estimated;
      continue;
    }

    const minimumUsefulTokens = message.role === 'user' ? 80 : 120;
    if (remaining >= minimumUsefulTokens) {
      result.push(trimMessageContent(message, remaining - 4));
      remaining = 0;
    }
    break;
  }

  return result;
};

const trimContextBlock = (block, maxTokens) => trimTextByTokens(block, maxTokens);

// WHAT THESE NUMBERS ARE, AND WHAT THEY ARE NOT
//
// They size *retrieval*: how much RAG to pull, how much file text to read, how
// much untrusted client-supplied history to accept. They are soft targets,
// computed before anything is assembled, so they cannot know what the turn
// actually weighs.
//
// They are NOT the safety mechanism. What keeps a prompt inside the model's
// window is measuring the assembled result — see contextWindow.service.js.
// Treating these as the ceiling is what previously both cut history on a model
// with 100K to spare and still let the sections sum past the window.
//
// They must nonetheless sum to at most 1.0. A set that sums to 1.4 tells every
// retrieval step it may spend more than exists, which produces exactly the
// oversized assembly the fitter then has to evict.
const STATIC_SPLIT = {
  system: 0.10,
  history: 0.30,
  rag: 0.15,
  file: 0.15,
  toolLoop: 0.15,
  query: 0.15,
};

const createPromptBudget = (modelConfig = {}) => {
  const modelLimit = modelConfig.maxTokens || 4096;
  const reservedOutputTokens = modelLimit >= 32000
    ? 4000
    : Math.min(4000, Math.max(800, Math.floor(modelLimit * 0.35)));
  const maxPromptTokens = Math.max(1200, modelLimit - reservedOutputTokens);

  const systemTokens = Math.floor(maxPromptTokens * STATIC_SPLIT.system);
  const historyTokens = Math.floor(maxPromptTokens * STATIC_SPLIT.history);
  const ragTokens = Math.floor(maxPromptTokens * STATIC_SPLIT.rag);
  const fileTokens = Math.floor(maxPromptTokens * STATIC_SPLIT.file);
  const toolLoopTokens = Math.floor(maxPromptTokens * STATIC_SPLIT.toolLoop);
  // Remainder rather than its own fraction, so rounding can never push the set
  // above maxPromptTokens.
  const queryTokens = Math.max(
    0,
    maxPromptTokens - systemTokens - historyTokens - ragTokens - fileTokens - toolLoopTokens
  );

  return {
    maxPromptTokens,
    toolLoopTokens,
    systemTokens,
    historyTokens,
    ragTokens,
    fileTokens,
    queryTokens,
  };
};

// ============================================================
// DYNAMIC BUDGET FUNCTIONS (ADD THESE)
// ============================================================

// 1. Detect complexity score from query + history
const calculateComplexityScore = (userQuery, historyText = '') => {
  // Tier 1: High-weight SAP/technical keywords (1.0 each)
  const highWeight = [
    'sap', 'abap', 'odata', 'hana', 'btp', 'algorithm', 'architecture',
    's4hana', 'fiori', 'cds', 'cap', 'cloudfoundry', 'kyma',
    'basis', 'transport', 'rfc', 'bapi', 'idoc', 'badi', 'user-exit',
    'enhancement-point', 'bopf', 'gateway', 'soamanager', 'lsmw',
    'slt', 'po', 'pi', 'solman', 'charm', 'tcode', 'spa/gko',
  ];

  // Tier 2: Medium-weight development keywords (0.5 each)
  const midWeight = [
    'code', 'implement', 'integration', 'database', 'api', 'endpoint',
    'navigation', 'crud', 'build', 'design', 'framework', 'technical',
    'sql', 'json', 'xml', 'config', 'debug', 'error', 'migration',
    'refactor', 'optimize', 'troubleshoot', 'deploy', 'monitor',
    'deep insert', 'function import',
    'rest', 'soap', 'graphql', 'grpc', 'oauth', 'jwt', 'saml',
    'docker', 'kubernetes', 'jenkins', 'gitlab', 'github', 'ci/cd',
    'terraform', 'ansible', 'helm', 'istio', 'prometheus', 'grafana',
    'postgres', 'mongodb', 'redis', 'kafka', 'rabbitmq', 'elasticsearch',
    'firewall', 'vpn', 'proxy', 'load-balancer', 'dns', 'tls', 'ssl',
    'microservices', 'event-driven', 'cqrs', 'saga', 'ddd',
    'unit-test', 'integration-test', 'e2e', 'tdd', 'mocking',
    'swagger', 'openapi', 'raml', 'postman', 'curl',
    'performance', 'latency', 'throughput', 'scalability',
    'authentication', 'authorization', 'rbac', 'abac', 'acl',
    'pipeline', 'workflow', 'orchestration', 'scheduler',
    'serverless', 'lambda', 'ec2', 's3', 'rds', 'sns', 'sqs',
    'azure', 'aws', 'gcp', 'cloud', 'vmware', 'hypervisor',
    'sap-fiori', 'sap-cloud-platform', 'sap-hana', 'sap-s4',
    'billing', 'invoice', 'purchase-order', 'sales-order',
    'warehouse', 'inventory', 'logistics', 'supply-chain',
    'master-data', 'business-partner', 'material', 'pricing',
    'workflow', 'approval', 'release-strategy', 'output-type',
    'batch-job', 'background-job', 'job-scheduling',
    'authorization-object', 'role', 'profile', 'user-group',
    'performance-tuning', 'indexing', 'partitioning', 'caching',
  ];

  let score = 0;

  // ── Keyword matching (weighted) ──────────────────────────
  const lowerQuery = userQuery.toLowerCase();

  // High-weight: each match +1.0, capped at 4
  const highMatches = highWeight.filter(kw => lowerQuery.includes(kw)).length;
  score += Math.min(highMatches * 1.0, 4);

  // Mid-weight: each match +0.5, capped at 3
  const midMatches = midWeight.filter(kw => lowerQuery.includes(kw)).length;
  score += Math.min(midMatches * 0.5, 3);

  // ── Code blocks ──────────────────────────────────────────
  if (userQuery.includes('```')) score += 1.5;

  // ── Technical patterns (regex) ───────────────────────────
  if (/select\s+.*\s+from/im.test(lowerQuery)) score += 1.0;       // SQL
  if (/create\s+(table|view|proc|function|index)/im.test(lowerQuery)) score += 1.0;
  if (/<[a-z]+[\s>]/i.test(userQuery) && /<\/?[a-z]+/i.test(userQuery)) score += 0.5;  // XML/HTML tags
  if (/\{[\s\S]*"[^"]+"\s*:/im.test(userQuery)) score += 0.5;      // JSON-like object
  if (/[A-Z]\w*\([^)]*\)/.test(userQuery)) score += 0.5;            // function call pattern

  // ── Query length (gradual scaling) ───────────────────────
  const wordCount = userQuery.split(/\s+/).length;
  score += Math.min(wordCount / 80, 2.5);  // 100 words → ~1.25, 200+ words → 2.5

  // ── History context ──────────────────────────────────────
  if (historyText && historyText.length > 0) {
    const lowerHistory = historyText.toLowerCase();
    const histHigh = highWeight.filter(kw => lowerHistory.includes(kw)).length;
    const histMid = midWeight.filter(kw => lowerHistory.includes(kw)).length;
    // Recent technical history adds context but capped low
    score += Math.min(histHigh * 0.4 + histMid * 0.15, 2);
  }

  // Clamp to 0-10
  return Math.max(0, Math.min(10, Math.round(score * 10) / 10));
};

// 2. Get turn count (number of messages in topic)
const getTopicTurnCount = async (topicId) => {
  try {
    const { count, error } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('topic_id', topicId)
      .eq('is_summary', false);

    if (error) {
      console.warn('[Dynamic Budget] Count error:', error.message);
      return 0;
    }

    return count || 0;
  } catch (err) {
    console.warn('[Dynamic Budget] getTopicTurnCount error:', err.message);
    return 0;
  }
};

// How much of the post-tool-loop budget history may claim. History is allocated
// first because it is the section whose size the turn cannot control; the rest
// is then split among sections that can simply be re-fetched smaller. Every
// branch leaves at least 35% for the other four.
const HISTORY_RATIO_NEW_TOPIC = 0.25;
const HISTORY_RATIO_DEFAULT = 0.45;
const HISTORY_RATIO_MEDIUM = 0.50;
const HISTORY_RATIO_DEEP = 0.65;

// Split of whatever history leaves behind, with `query` taking the remainder so
// the whole set always lands exactly on availableTokens rather than above it.
const REMAINDER_SPLIT = { system: 0.14, rag: 0.26, file: 0.26 };

const createDynamicPromptBudget = (turnCount, complexityScore, modelConfig = {}) => {
  const modelLimit = modelConfig.maxTokens || 8000;
  const reservedOutputTokens = modelLimit >= 32000
    ? 4000
    : Math.min(2000, Math.max(800, Math.floor(modelLimit * 0.25)));
  const maxPromptTokens = modelLimit - reservedOutputTokens;

  const toolLoopTokens = Math.floor(maxPromptTokens * 0.12);
  const availableTokens = maxPromptTokens - toolLoopTokens;

  let historyRatio = HISTORY_RATIO_DEFAULT;
  if (turnCount < 3) {
    historyRatio = HISTORY_RATIO_NEW_TOPIC;
  } else if (complexityScore > 7 || turnCount > 10) {
    // Long technical threads (logs, code, SAP) keep the most raw history.
    historyRatio = HISTORY_RATIO_DEEP;
  } else if (complexityScore > 5) {
    historyRatio = HISTORY_RATIO_MEDIUM;
  }

  const historyTokens = Math.floor(availableTokens * historyRatio);
  const remainder = availableTokens - historyTokens;

  const systemTokens = Math.floor(remainder * REMAINDER_SPLIT.system);
  const ragTokens = Math.floor(remainder * REMAINDER_SPLIT.rag);
  const fileTokens = Math.floor(remainder * REMAINDER_SPLIT.file);
  // Remainder-of-the-remainder, so rounding cannot push the set over.
  const queryTokens = Math.max(0, remainder - systemTokens - ragTokens - fileTokens);

  return {
    maxPromptTokens,
    toolLoopTokens,                                       // Agent decisions, token tracking
    systemTokens,
    historyTokens,                                        // ← DYNAMIC!
    ragTokens,
    fileTokens,
    queryTokens,
    // Debug info
    _debug: {
      turnCount,
      complexityScore: Math.round(complexityScore * 100) / 100,
      selectedHistoryBudget: historyTokens,
    },
  };
};

// 4. Smart trim (structure-aware)
const parseMemoryBlock = (text) => {
  const summaryMatch = text.match(
    /\[OLDER CONVERSATION SUMMARY\]([\s\S]*?)\[END OLDER CONVERSATION SUMMARY\]/
  );
  const latestMatch = text.match(
    /\[LATEST RAW CONVERSATION\]([\s\S]*?)\[END LATEST RAW CONVERSATION\]/
  );

  return {
    summary: summaryMatch ? summaryMatch[1].trim() : '',
    latest: latestMatch ? latestMatch[1].trim() : '',
    hasSummary: !!summaryMatch,
    hasLatest: !!latestMatch,
    prefix: text.substring(0, Math.min(
      text.indexOf('[OLDER CONVERSATION SUMMARY]') > -1 ? text.indexOf('[OLDER CONVERSATION SUMMARY]') : text.length,
      text.indexOf('[LATEST RAW CONVERSATION]') > -1 ? text.indexOf('[LATEST RAW CONVERSATION]') : text.length
    )),
  };
};

const rebuildMemoryBlock = (parsed) => {
  let result = parsed.prefix;

  if (parsed.hasSummary && parsed.summary) {
    result += `[OLDER CONVERSATION SUMMARY]\n${parsed.summary}\n[END OLDER CONVERSATION SUMMARY]\n\n`;
  }

  if (parsed.hasLatest && parsed.latest) {
    result += `[LATEST RAW CONVERSATION]\n${parsed.latest}\n[END LATEST RAW CONVERSATION]`;
  }

  return result;
};

const smartTrimContextBlock = (block, maxTokens) => {
  const totalTokens = estimateTokens(block);

  // Within budget: no trim needed
  if (totalTokens <= maxTokens) {
    return block;
  }

  const parsed = parseMemoryBlock(block);

  // No structured sections: fall back to dumb trim
  if (!parsed.hasSummary && !parsed.hasLatest) {
    return trimTextByTokens(block, maxTokens);
  }

  const summaryTokens = estimateTokens(parsed.summary);
  const latestTokens = estimateTokens(parsed.latest);
  const overheadTokens = 50; // Estimate for brackets/labels

  const availableBudget = maxTokens - overheadTokens;

  // STRATEGY 1: Latest fits + summary fits → keep both
  if (summaryTokens + latestTokens <= availableBudget) {
    return block; // No trim needed
  }

  // STRATEGY 2: Latest fits, summary doesn't → trim summary, keep latest
  if (latestTokens <= availableBudget) {
    const summaryBudget = availableBudget - latestTokens;
    const trimmedSummary = trimTextByTokens(parsed.summary, summaryBudget);

    return rebuildMemoryBlock({
      ...parsed,
      summary: trimmedSummary,
    });
  }

  // STRATEGY 3: Latest too big, drop summary → keep latest only
  if (latestTokens <= maxTokens * 0.85 && parsed.hasSummary) {
    return rebuildMemoryBlock({
      ...parsed,
      summary: '',
      hasSummary: false,
    });
  }

  // STRATEGY 4: Everything huge → trim both (80% latest, 20% summary)
  const latestBudget = Math.floor(availableBudget * 0.80);
  const summaryBudget = Math.floor(availableBudget * 0.20);

  const trimmedLatest = trimTextByTokens(parsed.latest, latestBudget);
  const trimmedSummary = trimTextByTokens(parsed.summary, summaryBudget);

  return rebuildMemoryBlock({
    ...parsed,
    summary: trimmedSummary,
    latest: trimmedLatest,
  });
};

module.exports = {
  CHARS_PER_TOKEN,
  createPromptBudget,
  createDynamicPromptBudget,              // ← ADD
  calculateComplexityScore,               // ← ADD
  getTopicTurnCount,                      // ← ADD
  estimateMessagesTokens,
  estimateTokens,
  fitMessagesToBudget,
  trimContextBlock,
  trimTextByTokens,
  smartTrimContextBlock,                  // ← ADD
  parseMemoryBlock,                       // ← ADD
  rebuildMemoryBlock,                     // ← ADD
};
