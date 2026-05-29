const { dispatchToAI, dispatchToAIStream } = require('./ai/dispatcher.service');
const { estimateMessagesTokens, estimateTokens } = require('./tokenBudget.service');
const { isPlaceholderOnly } = require('./chatCleanup.service');
const { processToolCall } = require('./toolProcessor.service');

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
  onStreamChunk = null,
}) => {
  let reply;
  let tokensUsed = 0;
  let totalAITokens = 0;
  let totalEmbeddingTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let finalReply = '';
  const generatedMedia = [];

  const toolRoundStart = aiMessages.length;
  const maxToolTokens = Math.floor(promptBudget.maxPromptTokens * 0.5);

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

    // ── Use streaming dispatch when onStreamChunk is provided ──
    // Buffer chunks during streaming; only forward on final round (no tool call).
    let streamedChunks = [];

    if (onStreamChunk) {
      const streamResult = await dispatchToAIStream(
        effectiveModelConfig,
        aiMessages,
        abortController.signal,
        (chunk) => { streamedChunks.push(chunk); }
      );
      reply = streamResult.text;
      tokensUsed = streamResult.tokensUsed;
      cacheCreationTokens += streamResult.cacheCreationTokens || 0;
      cacheReadTokens += streamResult.cacheReadTokens || 0;
      totalAITokens += tokensUsed || 0;
    } else {
      const result = await dispatchToAI(effectiveModelConfig, aiMessages, abortController.signal);
      reply = result.text;
      tokensUsed = result.tokensUsed;
      cacheCreationTokens += result.cacheCreationTokens || 0;
      cacheReadTokens += result.cacheReadTokens || 0;
      totalAITokens += tokensUsed || 0;
    }

    if (onAfterDispatch) {
      await onAfterDispatch({ round, result: { text: reply, tokensUsed, cacheCreationTokens, cacheReadTokens }, reply, tokensUsed });
    }

    console.log(`[${loggerPrefix}] Reply length: ${reply.length}`);
    if (abortController.signal.aborted) {
      return { aborted: true };
    }

    const toolResult = await processToolCall({
      ...processToolCallArgs,
      reply,
      aiMessages,
    });

    if (toolResult.handled) {
      // Tool call detected — discard streamed chunks (they contained tool syntax)
      streamedChunks = [];
      aiMessages.push(...toolResult.newMessages);
      totalEmbeddingTokens += toolResult.embedTokens || 0;
      if (toolResult.generatedMedia?.length) generatedMedia.push(...toolResult.generatedMedia);
      trimOldestToolRounds();

      if (onAfterToolHandled) {
        await onAfterToolHandled({
          round,
          reply,
          toolResult,
        });
      }

      continue;
    }

    // ── No tool call → this is the final round ──
    // Forward any buffered stream chunks to the client
    if (onStreamChunk && streamedChunks.length > 0) {
      for (const chunk of streamedChunks) {
        onStreamChunk(chunk);
      }
    }

    if (onNoToolCall) {
      const noToolResult = await onNoToolCall({
        round,
        reply,
        aiMessages,
        trimOldestToolRounds,
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
    cacheCreationTokens,
    cacheReadTokens,
    finalReply,
    generatedMedia,
  };
};

module.exports = {
  runToolLoop,
};
