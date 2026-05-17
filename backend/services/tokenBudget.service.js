// FILE: backend/services/tokenBudget.service.js
// PURPOSE: Lightweight prompt budgeting so RAG, files, and history cannot grow without bounds.

const supabase = require('../config/supabase');

/**
 * Estimate token count using a hybrid approach:
 * - Word-based: ~1.3 tokens per word (accurate for natural language)
 * - Char-based: ~4 chars per token (fallback for dense/text code)
 * - Uses max of both to be conservative (overestimate > underestimate)
 */
const estimateTokens = (text = '') => {
  if (!text) return 0;
  const str = String(text).trim();
  if (!str) return 0;

  const charEstimate = Math.ceil(str.length / 4);
  const words = str.split(/\s+/).length;
  const wordEstimate = Math.ceil(words * 1.3);

  // Average both estimates to avoid inflation from worst-case bias
  return Math.ceil((charEstimate + wordEstimate) / 2);
};

const CHARS_PER_TOKEN = 4; // kept for backward compatibility in trim logic

const trimTextByTokens = (text = '', maxTokens = 0) => {
  if (!text || maxTokens <= 0) return '';
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 16)).trim()}...`;
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

const createPromptBudget = (modelConfig = {}) => {
  const modelLimit = modelConfig.maxTokens || 4096;
  const reservedOutputTokens = Math.min(4000, Math.max(800, Math.floor(modelLimit * 0.35)));
  const maxPromptTokens = Math.max(1200, modelLimit - reservedOutputTokens);

  // BUDGET ALLOCATION: Total 100% (toolLoopTokens reserves for agent/dispatcher overhead)
  // For 16K model: maxPromptTokens ≈ 12000
  return {
    maxPromptTokens,
    toolLoopTokens: Math.floor(maxPromptTokens * 0.12),   // Agent decisions, token tracking, RAG scoring
    systemTokens: Math.floor(maxPromptTokens * 0.18),
    historyTokens: Math.floor(maxPromptTokens * 0.22),
    ragTokens: Math.floor(maxPromptTokens * 0.20),
    fileTokens: Math.floor(maxPromptTokens * 0.20),       // Reduced from 33% (was overcounting)
    queryTokens: Math.floor(maxPromptTokens * 0.08),
    // Total: 100%
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

// 3. Create dynamic budget based on conversation state
const createDynamicPromptBudget = (turnCount, complexityScore, modelConfig = {}) => {
  const modelLimit = modelConfig.maxTokens || 8000;
  const reservedOutputTokens = 2000;
  const maxPromptTokens = modelLimit - reservedOutputTokens; // 6000

  // Reserve tool-loop budget first (12% for agent overhead)
  const toolLoopTokens = Math.floor(maxPromptTokens * 0.12);
  const availableTokens = maxPromptTokens - toolLoopTokens;

  // INCREASED: Larger history budget so summary + latest messages fit
  // comfortably, preventing smartTrimContextBlock from dropping the summary
  // (which causes topic deviation in long complex chats).
  let historyTokens = Math.floor(availableTokens * 0.36); // Default ~1584 (was 2500)

  // New topic - keep it lean
  if (turnCount < 3) {
    historyTokens = Math.floor(availableTokens * 0.18); // ~792 (was 1000)
  }
  // Complex topic (SAP, code, technical) — needs full context
  else if (complexityScore > 7) {
    historyTokens = Math.floor(availableTokens * 0.58); // ~2552 (was 4000)
  }
  // Long conversation — needs full context
  else if (turnCount > 15) {
    historyTokens = Math.floor(availableTokens * 0.58); // ~2552 (was 4000)
  }
  // Medium complexity
  else if (complexityScore > 5) {
    historyTokens = Math.floor(availableTokens * 0.40); // ~1760 (was 2800)
  }

  return {
    maxPromptTokens,
    toolLoopTokens,                                       // Agent decisions, token tracking
    systemTokens: Math.floor(availableTokens * 0.20),
    historyTokens,                                        // ← DYNAMIC!
    ragTokens: Math.floor(availableTokens * 0.25),
    fileTokens: Math.floor(availableTokens * 0.19),
    queryTokens: Math.floor(availableTokens * 0.11),
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
