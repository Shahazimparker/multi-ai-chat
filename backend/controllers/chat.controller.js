// ============================================================
// FILE: backend/controllers/chat.controller.js
// PURPOSE: Legacy JSON chat compatibility endpoint — stream is canonical
// ============================================================

const { classifyError } = require('../services/chatCleanup.service');
const { CANONICAL_CHAT_PIPELINE_FLAGS, runChatPipeline } = require('../services/chatPipeline.service');

/**
 * POST /api/chat/message
 * Body: { modelId, message, topicId? }
 * Auth: Optional (anonymous users allowed but no history saved)
 */
const sendMessage = async (req, res) => {
  const startTime = Date.now();
  const {
    modelId,
    providerModelId,
    message,
    image,
    topicId,
    memoryMode = 'summarized',
    historyLimit = 5,
    ragEnabled = false,
    forceWebSearch = false,
  } = req.body;

  // ── Setup Abort Controller ─────────────────────────────────
  const abortController = new AbortController();
  const abortDownstreamTasks = () => {
    if (!abortController.signal.aborted && !res.writableEnded) {
      console.log('[Chat] User stopped the query. Aborting downstream tasks...');
      abortController.abort();
    }
  };
  req.on('aborted', abortDownstreamTasks);
  res.on('close', abortDownstreamTasks);

  const user = req.user;
  const isAnonymous = !user;

  const result = await runChatPipeline({
    modelId,
    providerModelId,
    message,
    image,
    topicId,
    user,
    isAnonymous,
    memoryMode,
    historyLimit,
    ragEnabled,
    forceWebSearch: Boolean(forceWebSearch),

    abortController,

    ...CANONICAL_CHAT_PIPELINE_FLAGS,
  });

  // ── Handle errors ──────────────────────────────────────────
  if (result.err) {
    if (result.errorType === 'aborted') return;

    console.error('[Chat] Error:', result.err.message);

    if (result.errorType === 'invalid_model' || result.errorType === 'query_too_long' || result.errorType === 'context_too_large') {
      return res.status(400).json({ error: result.userMessage });
    }

    const { errorType, userMessage } = classifyError(result.err.message);
    return res.status(503).json({
      error: userMessage,
      errorType,
      retryable: true,
      failedModelId: modelId,
    });
  }

  // ── Return response ────────────────────────────────────────
  res.json({
    reply: result.finalReply,
    tokensUsed: result.billableTokens,
    topicId: result.resolvedTopicId,
    cacheHit: result.cacheHit,
    orchestratorBrain: result.orchestratorBrain ? {
      enabled: true,
      traceId: result.orchestratorBrain.traceId,
      steps: result.orchestratorBrain.dashboard?.totalSteps,
      status: result.orchestratorBrain.dashboard?.status,
    } : undefined,
    model: result.modelConfig?.label,
    tokenStats: user ? {
      total: user.total_tokens,
      used: user.used_tokens + result.billableTokens,
      remaining: user.total_tokens - user.used_tokens - result.billableTokens,
    } : null,
  });
};

module.exports = { sendMessage };
