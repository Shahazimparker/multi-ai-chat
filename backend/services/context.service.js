// ============================================================
// FILE: backend/services/context.service.js
// PURPOSE: Builds chat memory context using memory modes
// ============================================================

const supabase = require('../config/supabase');
const { summarizeMemory } = require('./summary.service');


const clamp = (value, min, max) => {
  const number = Number(value);
  if (Number.isNaN(number)) return min;
  return Math.max(min, Math.min(max, number));
};

const getRecentMessages = async (topicId, limit = 10) => {
  const { data, error } = await supabase
    .from('messages')
    .select('role, content, created_at')
    .eq('topic_id', topicId)
    .eq('is_summary', false)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data || []).reverse();
};

const formatMessages = (messages) => {
  return messages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');
};

const toRoleMessage = (message) => ({
  role: message.role === 'assistant' ? 'assistant' : 'user',
  content: String(message.content || ''),
});

const buildRoleAwareContext = ({ memoryMode, olderSummary, latestMessages }) => {
  const context = [{
    role: 'system',
    content: memoryMode === 'accurate'
      ? 'Continue the same conversation. Use the summary and recent turns below as prior context. Prefer the most recent turns if there is any conflict.'
      : 'Continue the same conversation. Use the prior summary and recent turns below as memory for the next reply.',
  }];

  if (olderSummary) {
    context.push({
      role: 'assistant',
      content: `[Conversation summary]\n${olderSummary}`,
    });
  }

  context.push(...latestMessages.map(toRoleMessage));
  return context;
};

const getLatestSummary = async (topicId) => {
  const { data, error } = await supabase
    .from('messages')
    .select('content, created_at')
    .eq('topic_id', topicId)
    .eq('is_summary', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data || null;
};

const countMessagesAfter = async (topicId, createdAt) => {
  let query = supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('topic_id', topicId)
    .eq('is_summary', false);

  if (createdAt) query = query.gt('created_at', createdAt);

  const { count } = await query;
  return count || 0;
};

const saveTopicSummary = async ({ topicId, userId, summary, provider, model }) => {
  if (!topicId || !summary) return;

  await supabase.from('messages').insert({
    topic_id: topicId,
    user_id: userId || null,
    role: 'assistant',
    content: summary,
    model: `summary:${provider}/${model}`,
    tokens_used: 0,
    is_summary: true,
  });
};

const buildContextMessages = async (newQuery, topicId, options = {}, signal = null) => {
  if (!topicId) {
    return { context: [], isNewTopic: true };
  }

  const memoryMode = options.memoryMode || 'summarized';
  const requestedLimit = clamp(options.historyLimit || 15, 2, 25);

  // ✅ CHANGE: Import dynamic budget functions
  const {
    createDynamicPromptBudget,
    calculateComplexityScore,
    getTopicTurnCount,
  } = require('./tokenBudget.service');

  // ✅ NEW: Calculate complexity score
  let totalHistoryText = '';
  const recentForAnalysis = await getRecentMessages(topicId, 10);
  if (recentForAnalysis.length > 0) {
    totalHistoryText = formatMessages(recentForAnalysis);
  }
  const complexityScore = calculateComplexityScore(newQuery, totalHistoryText);

  // ✅ NEW: Get turn count
  const turnCount = await getTopicTurnCount(topicId);

  // ✅ NEW: Create dynamic budget instead of static 900
  const dynamicBudget = createDynamicPromptBudget(
    turnCount,
    complexityScore,
    { maxTokens: 8000 }
  );
  const tokenBudget = options.tokenBudget || dynamicBudget.historyTokens;

  // ✅ Log for debugging
  console.log(`[Context] Complexity: ${complexityScore.toFixed(2)}, Turns: ${turnCount}, Budget: ${tokenBudget} tokens`);

  const userId = options.userId || null;

  const rawLimit = memoryMode === 'accurate'
    ? requestedLimit
    : Math.max(requestedLimit, 25);

  const recent = await getRecentMessages(topicId, rawLimit);
  if (recent.length === 0) return { context: [], isNewTopic: true };

  const latestRawCount = requestedLimit;
  const olderMessages = recent.slice(0, Math.max(0, recent.length - latestRawCount));
  const latestMessages = recent.slice(-latestRawCount);

  let olderSummaryText = '';

  const latestSummary = await getLatestSummary(topicId);
  const messagesSinceSummary = await countMessagesAfter(topicId, latestSummary?.created_at);

  let summaryTokens = 0;  // ← track summary LLM tokens

  if (latestSummary && messagesSinceSummary < 8) {
    olderSummaryText = latestSummary.content;
  } else if (olderMessages.length >= 8) {
    const olderText = formatMessages(olderMessages);
    const textToSummarize = latestSummary
      ? `Existing summary:\n${latestSummary.content}\n\nNewer conversation:\n${olderText}`
      : olderText;
    const summaryResult = await summarizeMemory(textToSummarize, signal);
    const { summary, provider, model } = summaryResult;
    summaryTokens = summaryResult.tokensUsed || 0;  // ← capture token usage
    await saveTopicSummary({ topicId, userId, summary, provider, model });
    olderSummaryText = `${summary}\n[Summary source: ${provider}/${model}]`;
  }

  const latestContextMessages = [];
  let runningTokens = 0;
  for (let i = latestMessages.length - 1; i >= 0; i--) {
    const message = toRoleMessage(latestMessages[i]);
    const estimatedTokens = Math.ceil(String(message.content || '').length / 4) + 4;
    if (latestContextMessages.length > 0 && runningTokens + estimatedTokens > tokenBudget * 0.6) {
      break;
    }
    latestContextMessages.unshift(message);
    runningTokens += estimatedTokens;
  }

  const context = buildRoleAwareContext({
    memoryMode,
    olderSummary: olderSummaryText,
    latestMessages: latestContextMessages.length > 0 ? latestContextMessages : latestMessages,
  });

  return {
    context,
    isNewTopic: false,
    summaryTokens,  // ← expose summary token usage to caller
    _debug: {
      complexity: complexityScore,
      turnCount,
      allocatedBudget: tokenBudget,
    },
  };
};

const maybeCompressQuery = async (query, signal = null) => {
  const wordCount = query.split(/\s+/).length;
  if (wordCount < 300) return { query, tokensUsed: 0 };

  const result = await summarizeMemory(query, signal);
  return { query: result.summary || query, tokensUsed: result.tokensUsed || 0 };
};

module.exports = { buildContextMessages, maybeCompressQuery, getRecentMessages };
