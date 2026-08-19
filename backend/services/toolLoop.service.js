const { dispatchToAI, dispatchToAIStream } = require('./ai/dispatcher.service');
const { estimateMessagesTokens, estimateTokens } = require('./tokenBudget.service');
const { processToolCall } = require('./toolProcessor.service');

const runToolLoop = async ({
  effectiveModelConfig,
  aiMessages,
  abortController,
  processToolCallArgs,
  promptBudget,
  maxToolRounds,
  deadlineAt = null,
  loggerPrefix = 'Tool',
  onBeforeDispatch = null,
  onAfterDispatch = null,
  onAfterToolHandled = null,
  onNoToolCall = null,
  onStreamChunk = null,
}) => {
  const emitStatus = (payload) => {
    if (typeof processToolCallArgs?.onStatus === 'function') {
      processToolCallArgs.onStatus(payload);
    }
  };

  // Returns whether anything was actually emitted, so callers can tell an empty
  // buffer apart from a flushed one.
  const streamBufferedReplyAsTokens = (chunks, emitChunk) => {
    const fullText = chunks.join('');
    if (!fullText) return false;
    const tokenLikeParts = fullText.match(/\S+\s*|\s+/g) || [fullText];
    for (const part of tokenLikeParts) emitChunk(part);
    return true;
  };

  let reply;
  let aiResponse = null;
  let tokensUsed = 0;
  let totalAITokens = 0;
  let totalEmbeddingTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let finalReply = '';
  let timedOut = false;
  let roundsUsed = 0;
  // Whether any reply text has reached the client. Callers compensating for a
  // short-circuited loop need this to avoid re-sending text already streamed.
  let streamedToClient = false;
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
    // Stop before starting a round the invocation probably cannot finish — being
    // killed mid-round truncates the SSE stream with no error. Round 0 always
    // runs: without it there is no reply to return at all.
    if (round > 0 && deadlineAt && Date.now() >= deadlineAt) {
      timedOut = true;
      console.warn(`[${loggerPrefix}] Time budget exhausted after ${round} round(s) — stopping loop early`);
      emitStatus({
        type: 'status',
        tool: 'tool_loop',
        message: 'Taking too long — wrapping up with what I have...',
      });
      break;
    }
    roundsUsed = round + 1;
    console.log(`[${loggerPrefix}] Round ${round}/${maxToolRounds}`);
    emitStatus({
      type: 'status',
      tool: 'tool_loop',
      message: round === 0 ? 'Thinking...' : 'Continuing with tool results...',
    });
    if (onBeforeDispatch) await onBeforeDispatch({ round });

    let streamedChunks = [];

    if (onStreamChunk) {
      const streamResult = await dispatchToAIStream(
        effectiveModelConfig,
        aiMessages,
        abortController.signal,
        (chunk) => { streamedChunks.push(chunk); }
      );
      aiResponse = streamResult;
      reply = streamResult.text;
      tokensUsed = streamResult.tokensUsed;
      cacheCreationTokens += streamResult.cacheCreationTokens || 0;
      cacheReadTokens += streamResult.cacheReadTokens || 0;
      totalAITokens += tokensUsed || 0;
    } else {
      const result = await dispatchToAI(effectiveModelConfig, aiMessages, abortController.signal);
      aiResponse = result;
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
      aiResponse,
      aiMessages,
    });

    if (toolResult.handled) {
      streamedChunks = [];
      emitStatus({
        type: 'status',
        tool: 'tool_loop',
        message: 'Using tool and preparing response...',
      });
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

    if (onStreamChunk && streamedChunks.length > 0) {
      const emitted = streamBufferedReplyAsTokens(streamedChunks, onStreamChunk);
      streamedToClient = streamedToClient || emitted;
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
    timedOut,
    roundsUsed,
    streamedToClient,
  };
};

module.exports = {
  runToolLoop,
};
