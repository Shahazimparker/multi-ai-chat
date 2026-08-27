// ============================================================
// FILE: backend/services/context.service.js
// PURPOSE: Builds chat memory context using memory modes
// ============================================================

const supabase = require('../config/supabase');
const { summarizeMemory } = require('./summary.service');
const { HISTORY_WINDOW_STEP } = require('../config/chatRuntime.config');


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
    // `id` breaks ties deterministically. Rows written before created_at was set
    // explicitly share a timestamp per turn, and without a tiebreaker Postgres
    // resolved those ties differently between requests — the same history came
    // back in a different order each time, which changes the prompt prefix and
    // costs the provider cache. This cannot recover the true order of those old
    // rows, but it does make it stable.
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data || []).reverse();
};

/** Fetch all non-summary messages after a given timestamp, capped by token budget */
const getMessagesSince = async (topicId, sinceTimestamp, maxTokens = 3000) => {
  if (!sinceTimestamp) return [];
  let query = supabase
    .from('messages')
    .select('role, content, created_at')
    .eq('topic_id', topicId)
    .eq('is_summary', false)
    .gt('created_at', sinceTimestamp)
    .order('created_at', { ascending: true });

  const { data, error } = await query;
  if (error) {
    console.error('[Context] getMessagesSince error:', error.message);
    return [];
  }

  // Apply token cap — keep newest messages within budget
  const messages = data || [];
  let tokens = 0;
  const capped = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = Math.ceil(String(messages[i].content || '').length / 4) + 4;
    if (tokens + t > maxTokens) break;
    capped.unshift(messages[i]);
    tokens += t;
  }
  return capped;
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
  // Wording tracks the actual layout: the recent turns follow immediately, and
  // the summary of everything older now arrives after them, under an
  // "Earlier Conversation Summary" heading. Saying "the summary below" while it
  // sat after the turns would have described a prompt that no longer exists.
  const instruction = memoryMode === 'accurate'
    ? 'Continue the same conversation. The recent turns follow; a summary of earlier turns appears later under "Earlier Conversation Summary". Use both as prior context, and prefer the most recent turns if there is any conflict.'
    : 'Continue the same conversation. The recent turns follow; a summary of earlier turns appears later under "Earlier Conversation Summary". Use both as memory for the next reply.';

  // The instruction is constant for a given memoryMode, so it stays at the head
  // of the history where it forms part of the cacheable prefix.
  //
  // The SUMMARY deliberately does not travel with it. It is regenerated every
  // ~12 messages, and sitting at the front of the history it invalidated every
  // raw turn behind it each time that happened. The caller receives it
  // separately (see `olderSummary` in the return value) and places it in the
  // volatile block with the rest of the per-turn content, after the raw turns.
  //
  // A system message here also keeps Gemini happy, which rejects a history
  // whose first turn is a model turn.
  const context = [{ role: 'system', content: instruction }];

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
  // Upper bound raised from 50 to 200. This clamp is a sanity guard against a
  // malformed request, not the context policy — that is the measured eviction in
  // contextWindow.service.js, which sends whatever fits and drops whole turns
  // only when it genuinely does not. A low clamp here silently capped a 128K
  // model at a few exchanges no matter what the client asked for.
  const requestedLimit = clamp(options.historyLimit || 20, 2, 200);

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
    { maxTokens: options.modelMaxTokens || 8000 }
  );
  const tokenBudget = options.tokenBudget || dynamicBudget.historyTokens;

  // ✅ Log for debugging
  console.log(`[Context] Complexity: ${complexityScore.toFixed(2)}, Turns: ${turnCount}, Budget: ${tokenBudget} tokens`);

  const userId = options.userId || null;

  // The raw-history window is anchored to the OLDEST message it keeps, not the
  // newest, and that anchor only advances in HISTORY_WINDOW_STEP jumps.
  //
  // Taking "the newest N" slides the window by one every turn, so the first
  // history message differs on every request and the prompt prefix diverges
  // right where the history begins — invalidating the provider cache on every
  // turn for any thread longer than N. Quantising the anchor keeps the prefix
  // byte-identical between jumps, with history growing append-only in between.
  const overflow = Math.max(0, turnCount - requestedLimit);
  const skipOldest = Math.floor(overflow / HISTORY_WINDOW_STEP) * HISTORY_WINDOW_STEP;
  // Grows from `requestedLimit` up to `requestedLimit + step - 1`, then the
  // anchor jumps forward and it drops back.
  const windowSize = Math.max(requestedLimit, turnCount - skipOldest);

  const rawLimit = memoryMode === 'accurate'
    ? windowSize
    : Math.max(windowSize, 35);

  const recent = await getRecentMessages(topicId, rawLimit);
  if (recent.length === 0) return { context: [], isNewTopic: true };

  // getRecentMessages returns the newest `rawLimit` in chronological order, so
  // taking the last `windowSize` of those lands exactly on the quantised anchor.
  const latestRawCount = Math.min(windowSize, recent.length);
  const olderMessages = recent.slice(0, Math.max(0, recent.length - latestRawCount));
  const latestMessages = recent.slice(-latestRawCount);

  let olderSummaryText = '';

  const latestSummary = await getLatestSummary(topicId);
  const messagesSinceSummary = await countMessagesAfter(topicId, latestSummary?.created_at);

  let summaryTokens = 0;  // ← track summary LLM tokens

  if (latestSummary && messagesSinceSummary < 12) {
    olderSummaryText = latestSummary.content;
  } else {
    // Topic-aware summarization: fetch messages since last summary if history grows very long
    const messagesToSummarize = latestSummary?.created_at
      ? await getMessagesSince(topicId, latestSummary.created_at, 8000)
      : olderMessages;

    if (messagesToSummarize.length >= 6) {
      const olderText = formatMessages(messagesToSummarize);
      const textToSummarize = latestSummary
        ? `Existing summary:\n${latestSummary.content}\n\nNewer conversation:\n${olderText}`
        : olderText;
      // Dynamic word limit: complex/long conversations get 650 words, default 450
      const summaryWordLimit = (complexityScore >= 7 || turnCount > 15) ? 650 : 450;
      const summaryResult = await summarizeMemory(textToSummarize, signal, newQuery, summaryWordLimit);
      const { summary, provider, model } = summaryResult;
      summaryTokens = summaryResult.tokensUsed || 0;
      await saveTopicSummary({ topicId, userId, summary, provider, model });
      olderSummaryText = `${summary}\n[Summary source: ${provider}/${model}]`;
    } else if (latestSummary) {
      // Not enough new messages but summary exists — keep old one
      olderSummaryText = latestSummary.content;
    }
  }

  const latestContextMessages = [];
  let runningTokens = 0;
  for (let i = latestMessages.length - 1; i >= 0; i--) {
    const message = toRoleMessage(latestMessages[i]);
    const estimatedTokens = Math.ceil(String(message.content || '').length / 4) + 4;
    // Keep raw turns up to 95% of the history budget to preserve full raw context
    const isMinimumKeep = latestContextMessages.length < 2;
    if (!isMinimumKeep && runningTokens + estimatedTokens > tokenBudget * 0.95) {
      break;
    }
    latestContextMessages.unshift(message);
    runningTokens += estimatedTokens;
  }

  // A window opening on an assistant turn is an orphaned answer, and Gemini
  // rejects history that doesn't start with a user turn.
  while (latestContextMessages.length > 0 && latestContextMessages[0].role !== 'user') {
    latestContextMessages.shift();
  }

  const context = buildRoleAwareContext({
    memoryMode,
    olderSummary: olderSummaryText,
    latestMessages: latestContextMessages,
  });

  return {
    context,
    isNewTopic: false,
    // Handed back rather than embedded in `context` so the caller can place it
    // after the raw turns, where regenerating it does not invalidate them.
    olderSummary: olderSummaryText || '',
    summaryTokens,  // ← expose summary token usage to caller
    _debug: {
      complexity: complexityScore,
      turnCount,
      allocatedBudget: tokenBudget,
    },
  };
};

const maybeCompressQuery = async (query, signal = null) => {
  // Query compression is disabled for all models to preserve raw prompt fidelity and avoid unexpected OpenRouter background token spend.
  // Code is preserved below for reference / future opt-in:
  /*
  const wordCount = query.split(/\s+/).length;
  if (wordCount < 300) return { query, tokensUsed: 0 };

  const result = await summarizeMemory(query, signal);
  return { query: result.summary || query, tokensUsed: result.tokensUsed || 0 };
  */
  return { query, tokensUsed: 0 };
};

module.exports = { buildContextMessages, maybeCompressQuery, getRecentMessages };
