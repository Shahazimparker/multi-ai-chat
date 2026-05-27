const { dispatchToAI } = require('./ai/dispatcher.service');
const { estimateMessagesTokens, estimateTokens } = require('./tokenBudget.service');
const bizDbState = require('./bizDbState.service');
const { isPlaceholderOnly } = require('./chatCleanup.service');
const { processToolCall } = require('./toolProcessor.service');

const runToolLoop = async ({
  effectiveModelConfig,
  aiMessages,
  abortController,
  processToolCallArgs,
  effectiveDbOnly,
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
  let dbOnlyNudged = false;

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

      if (consecutiveZeroResults >= bizDbState.MAX_CONSECUTIVE_ZERO_RESULTS) {
        finalReply = reply.replace(/\[QUERY_DB\][\s\S]*?(?:\[\/QUERY_DB\]|<\/SQL_QUERY>|<\/QUERY_DB>)/g, '').trim() || 'No data found.';
        console.log(`[${loggerPrefix}] ${bizDbState.MAX_CONSECUTIVE_ZERO_RESULTS} consecutive zero results - breaking tool loop`);
        break;
      }

      if (dbQueryCount >= bizDbState.MAX_DB_QUERIES) {
        if (!finalReply) finalReply = 'Maximum database queries reached.';
        console.log(`[${loggerPrefix}] Max DB queries (${dbQueryCount}) reached - breaking tool loop`);
        break;
      }
      continue;
    }

    if (effectiveDbOnly && dbQueried && isPlaceholderOnly(reply)) {
      console.log(`[${loggerPrefix}] dbOnly enforcement: placeholder-only reply detected - forcing summary`);
      aiMessages.push({ role: 'assistant', content: reply });
      aiMessages.push({
        role: 'user',
        content: '[SYSTEM] Your previous reply was only a status placeholder (e.g., "[Querying...]"). The database results above are final. Now write the COMPLETE final answer to the user using ONLY those results - plain prose plus a markdown table where helpful. No SQL, no placeholders, no further queries.',
      });
      trimOldestToolRounds();
      continue;
    }

    if (effectiveDbOnly && bizDbState.bizDbConnected && !dbQueried && !dbOnlyNudged) {
      const isGreetingOrMeta = /^\s*(hi|hello|hey|thanks|thank\s+you|bye|goodbye|ok|okay|what\s+model|who\s+are\s+you|what\s+are\s+you)[\s!.?]*$/i.test(String(getNudgeSourceText() || '').trim());
      if (!isGreetingOrMeta) {
        console.log(`[${loggerPrefix}] dbOnly enforcement: AI skipped DB query - nudging to use [QUERY_DB]`);
        aiMessages.push({ role: 'assistant', content: reply });
        aiMessages.push({
          role: 'user',
          content: '[SYSTEM] DB-ONLY MODE is ACTIVE. You answered without querying the database. You MUST use [QUERY_DB]...[/QUERY_DB] to fetch live data from the business DB before answering. If you do not know the schema, call [GET_SCHEMA:table_name] first. Do not answer from training data.',
        });
        dbOnlyNudged = true;
        trimOldestToolRounds();
        continue;
      }
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
  };
};

module.exports = {
  runToolLoop,
};
