// FILE: backend/services/tokenBudget.service.js
// PURPOSE: Lightweight prompt budgeting so RAG, files, and history cannot grow without bounds.

const CHARS_PER_TOKEN = 4;
const supabase = require('../config/supabase');
const estimateTokens = (text = '') => Math.ceil(String(text).length / CHARS_PER_TOKEN);

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
  const reservedOutputTokens = Math.min(1600, Math.max(800, Math.floor(modelLimit * 0.35)));
  const maxPromptTokens = Math.max(1200, modelLimit - reservedOutputTokens);

  return {
    maxPromptTokens,
    systemTokens: Math.floor(maxPromptTokens * 0.34),
    historyTokens: Math.floor(maxPromptTokens * 0.28),
    ragTokens: Math.floor(maxPromptTokens * 0.18),
    fileTokens: Math.floor(maxPromptTokens * 0.16),
    queryTokens: Math.floor(maxPromptTokens * 0.18),
  };
};

// ============================================================
// DYNAMIC BUDGET FUNCTIONS (ADD THESE)
// ============================================================

// 1. Detect complexity score from query + history
const calculateComplexityScore = (userQuery, historyText = '') => {
  const complexityKeywords = [
    'sap', 'abap', 'odata', 'hana', 'btp', 'code', 'implement',
    'architecture', 'integration', 'database', 'api', 'endpoint',
    'deep insert', 'navigation', 'crud', 'function import',
    'build', 'design', 'algorithm', 'technical', 'framework'
  ];

  let score = 0;

  // Check keywords in query
  const lowerQuery = userQuery.toLowerCase();
  const keywordMatches = complexityKeywords.filter(kw => lowerQuery.includes(kw)).length;
  score += Math.min(keywordMatches * 0.5, 3);

  // Check if query has code blocks
  if (userQuery.includes('```') || userQuery.includes('```javascript')) {
    score += 1.5;
  }

  // Check query length (longer = more complex usually)
  const queryLength = userQuery.split(/\s+/).length;
  if (queryLength > 100) score += 1;
  if (queryLength > 200) score += 1;

  // Check history for technical context
  if (historyText && historyText.length > 0) {
    const lowerHistory = historyText.toLowerCase();
    const historyMatches = complexityKeywords.filter(kw => lowerHistory.includes(kw)).length;
    score += Math.min(historyMatches * 0.3, 2);
  }

  // Clamp to 0-10
  return Math.max(0, Math.min(10, score));
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

  let historyTokens = 1200; // Default

  // New topic - keep it lean
  if (turnCount < 3) {
    historyTokens = 500;
  }
  // Complex topic (SAP, code, technical)
  else if (complexityScore > 7) {
    historyTokens = 2000;
  }
  // Long conversation
  else if (turnCount > 15) {
    historyTokens = 2000;
  }
  // Medium complexity
  else if (complexityScore > 5) {
    historyTokens = 1500;
  }

  return {
    maxPromptTokens,
    systemTokens: Math.floor(maxPromptTokens * 0.20),
    historyTokens,                                        // ← DYNAMIC!
    ragTokens: Math.floor(maxPromptTokens * 0.15),
    fileTokens: Math.floor(maxPromptTokens * 0.15),
    queryTokens: Math.floor(maxPromptTokens * 0.20),
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
