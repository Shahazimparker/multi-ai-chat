const { dispatchToAI } = require('./ai/dispatcher.service');
const { estimateMessagesTokens, estimateTokens } = require('./tokenBudget.service');
const { isPlaceholderOnly } = require('./chatCleanup.service');
const { processToolCall } = require('./toolProcessor.service');

const MAX_CONSECUTIVE_ZERO_RESULTS = 4;
const MAX_DB_QUERIES = 12;

const runToolLoop = async ({
  effectiveModelConfig,
  aiMessages,
  abortController,
  processToolCallArgs,
  promptBudget,
  maxToolRounds,
  loggerPrefix = 'Tool',
  getNudgeSourceText = () => '',
  onBeforeDispatch = null,
  onAfterDispatch = null,
  onAfterToolHandled = null,
  onNoToolCall = null,
}) => {
  let reply;
  let tokensUsed = 0;
  let totalAITokens = 0;
  let totalEmbeddingTokens = 0;
  let finalReply = '';
  let dbQueried = false;
  let lastDbResultBlock = '';
  let lastSqlQuery = '';
  let consecutiveZeroResults = processToolCallArgs.consecutiveZeroResults || 0;
  let dbQueryCount = processToolCallArgs.dbQueryCount || 0;
  const generatedMedia = []; // accumulates image/PPT files created during tool rounds

  const toolRoundStart = aiMessages.length;
  const getMaxToolTokens = (currentDbQueryCount) => {
    if (currentDbQueryCount > 5) return Math.floor(promptBudget.maxPromptTokens * 0.65);
    return Math.floor(promptBudget.maxPromptTokens * 0.5);
  };
  let maxToolTokens = getMaxToolTokens(dbQueryCount);

  const trimOldestToolRounds = () => {
    const estimatedToolTokens = estimateMessagesTokens(aiMessages.slice(toolRoundStart));
    if (estimatedToolTokens <= maxToolTokens) return;

    while (aiMessages.length > toolRoundStart + 2) {
      const oldPairTokens = estimateTokens(aiMessages[toolRoundStart].content || '') +
        estimateTokens(aiMessages[toolRoundStart + 1].content || '') + 8;
      aiMessages.splice(toolRoundStart, 2);
      console.log(`[${loggerPrefix}] Trimmed oldest tool round (~${oldPairTokens} tokens) - ${aiMessages.length - toolRoundStart} tool messages remain`);
      if (estimateMessagesTokens(aiMessages.slice(toolRoundStart)) <= maxToolTokens) break;
    }
  };

  for (let round = 0; round < maxToolRounds; round++) {
    console.log(`[${loggerPrefix}] Round ${round}/${maxToolRounds}`);
    if (onBeforeDispatch) await onBeforeDispatch({ round });

    const result = await dispatchToAI(effectiveModelConfig, aiMessages, abortController.signal);
    reply = result.text;
    tokensUsed = result.tokensUsed;
    totalAITokens += tokensUsed || 0;
    if (onAfterDispatch) {
      await onAfterDispatch({ round, result, reply, tokensUsed });
    }

    console.log(`[${loggerPrefix}] Reply length: ${reply.length}, Has [QUERY_DB]: ${reply.includes('[QUERY_DB]')}, Has <QUERY_DB>: ${reply.includes('<QUERY_DB>')}`);
    if (abortController.signal.aborted) {
      return { aborted: true };
    }

    const toolResult = await processToolCall({
      ...processToolCallArgs,
      reply,
      aiMessages,
      consecutiveZeroResults,
      dbQueryCount,
    });

    if (toolResult.handled) {
      aiMessages.push(...toolResult.newMessages);
      totalEmbeddingTokens += toolResult.embedTokens || 0;
      if (toolResult.dbQueried) dbQueried = true;
      if (toolResult.lastSqlQuery) lastSqlQuery = toolResult.lastSqlQuery;
      if (toolResult.lastDbResultBlock) lastDbResultBlock = toolResult.lastDbResultBlock;
      if (toolResult.generatedMedia?.length) generatedMedia.push(...toolResult.generatedMedia);
      consecutiveZeroResults = toolResult.consecutiveZeroResults || 0;
      if (toolResult.dbQueryCount !== undefined) {
        dbQueryCount = toolResult.dbQueryCount;
        maxToolTokens = getMaxToolTokens(dbQueryCount);
      }
      trimOldestToolRounds();

      if (onAfterToolHandled) {
        await onAfterToolHandled({
          round,
          reply,
          toolResult,
          state: { dbQueried, lastDbResultBlock, lastSqlQuery, consecutiveZeroResults, dbQueryCount },
        });
      }

      if (consecutiveZeroResults >= MAX_CONSECUTIVE_ZERO_RESULTS) {
        finalReply = reply.replace(/\[QUERY_DB\][\s\S]*?(?:\[\/QUERY_DB\]|<\/SQL_QUERY>|<\/QUERY_DB>)/g, '').trim() || 'No data found.';
        console.log(`[${loggerPrefix}] ${MAX_CONSECUTIVE_ZERO_RESULTS} consecutive zero results - breaking tool loop`);
        break;
      }

      if (dbQueryCount >= MAX_DB_QUERIES) {
        if (!finalReply) finalReply = 'Maximum database queries reached.';
        console.log(`[${loggerPrefix}] Max DB queries (${dbQueryCount}) reached - breaking tool loop`);
        break;
      }
      continue;
    }

    if (onNoToolCall) {
      const noToolResult = await onNoToolCall({
        round,
        reply,
        aiMessages,
        trimOldestToolRounds,
        state: { dbQueried, lastDbResultBlock, lastSqlQuery, consecutiveZeroResults, dbQueryCount },
      });
      if (noToolResult?.continueLoop) continue;
      finalReply = noToolResult?.finalReply !== undefined ? noToolResult.finalReply : reply;
      break;
    }

    finalReply = reply;
    break;
  }

  if (!finalReply) finalReply = reply || '';

  return {
    aborted: false,
    reply,
    tokensUsed,
    totalAITokens,
    totalEmbeddingTokens,
    finalReply,
    dbQueried,
    lastDbResultBlock,
    lastSqlQuery,
    consecutiveZeroResults,
    dbQueryCount,
    generatedMedia,
  };
};

module.exports = {
  runToolLoop,
};
