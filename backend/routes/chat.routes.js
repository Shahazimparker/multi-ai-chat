// ============================================================
// FILE: backend/routes/chat.routes.js
// PURPOSE: Chat endpoints — authentication required throughout
// ============================================================

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { sendMessage } = require('../controllers/chat.controller');
const { tokenCheck } = require('../middleware/tokenCheck');
const { sanitizeBody, sanitizeInput, sanitizeText } = require('../middleware/sanitize');
const { MODELS } = require('../config/models');
const { getProviderModels } = require('../services/modelCatalog.service');
const { classifyError } = require('../services/chatCleanup.service');
const { CANONICAL_CHAT_PIPELINE_FLAGS, runChatPipeline } = require('../services/chatPipeline.service');
const { describeReasoning } = require('../services/ai/reasoning.service');
const { requireAuth } = require('../middleware/auth');
const { createRateLimitStore } = require('../services/rateLimitStore.service');

// Rate limit: 30 requests/minute per IP. Postgres-backed (see
// rateLimitStore.service.js) so the count survives across serverless instances.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests. Please slow down.' },
  store: createRateLimitStore('chat'),
});

// GET /api/chat/models — list of available models
router.get('/models', requireAuth, (req, res) => {
  const models = Object.entries(MODELS).map(([id, cfg]) => ({
    id,
    label: cfg.label,
    provider: cfg.provider,
    paid: cfg.paid,
    unified: !!cfg.unified,
    supportsVision: !!cfg.supportsVision,
    models: cfg.models || [],
    // null when the model cannot think — the UI greys the Thinking button out.
    reasoning: describeReasoning(cfg),
  }));
  res.json({ models });
});
// Rate-limited: this triggers a real outbound call to the provider using our
// own API key, and `?refresh=true` bypasses the cache entirely.
router.get('/provider-models/:provider', chatLimiter, requireAuth, async (req, res) => {
  try {
    const refresh = req.query.refresh === 'true';
    const result = await getProviderModels(req.params.provider, { refresh });

    res.json({
      provider: result.provider,
      cached: result.cached,
      models: result.models,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message || 'Failed to fetch provider models',
      models: [],
    });
  }
});

// `message` is free text bound for an LLM and for React rendering — both
// safe from raw HTML by design — so it only gets the gentle sanitizer
// (control chars / line separators). Tag-stripping it silently mangles
// legitimate content like `Array<string>` or `a < b`. `image` is a base64
// data URL: not HTML either, and too large to regex on every request, so it
// is left out of the sanitizer entirely. The remaining fields are
// identifiers and keep the strict, tag-stripping sanitizer.
const chatBodySanitizer = sanitizeBody({
  message: sanitizeText,
  providerModelId: sanitizeInput,
  modelId: sanitizeInput,
  memoryMode: sanitizeInput,
  clientTimeZone: sanitizeInput,
});

// POST /api/chat/message — legacy JSON compatibility; /stream is the canonical chat path
router.post('/message', chatLimiter, requireAuth, tokenCheck, chatBodySanitizer, sendMessage);
/**
 * POST /api/chat/stream
 * Canonical chat endpoint using Server-Sent Events
 */
router.post('/stream', chatLimiter, requireAuth, tokenCheck, chatBodySanitizer, async (req, res) => {
  req.setTimeout(0);
  res.setTimeout(0);
  const startTime = Date.now();
  const {
    message,
    image,
    topicId,
    modelId = 'ministral-8b',
    providerModelId,
    memoryMode = 'accurate',
    historyLimit = 5,
    ragEnabled = false,
    forceWebSearch = false,
    selectedCollectionIds = [],
    thinkingEnabled,
    reasoningEffort = null,
    history,
    clientTimeZone,
  } = req.body;

  const user = req.user;
  const isAnonymous = !user;
  const abortController = new AbortController();
  const abortDownstreamTasks = () => {
    if (!abortController.signal.aborted && !res.writableEnded) {
      console.log('[Stream] Client disconnected. Aborting downstream tasks...');
      abortController.abort();
    }
  };
  req.on('aborted', abortDownstreamTasks);
  res.on('close', abortDownstreamTasks);

  // ── SSE headers + initial connect event ────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Reverse proxies in front of the app (nginx, and Vercel's edge) buffer a
  // response body by default, which collects the whole stream and delivers it
  // as one burst — exactly the symptom live streaming is meant to fix.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write('data: {"status": "connected"}\n\n');

  // ── Run the shared pipeline ────────────────────────────────
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
    selectedCollectionIds,
    // undefined, not a coerced boolean: an absent field must fall through to
    // the model's own default rather than silently meaning "on".
    thinkingEnabled: typeof thinkingEnabled === 'boolean' ? thinkingEnabled : undefined,
    reasoningEffort: typeof reasoningEffort === 'string' ? reasoningEffort : null,
    history,
    clientTimeZone: typeof clientTimeZone === 'string' ? clientTimeZone : undefined,
    abortController,

    ...CANONICAL_CHAT_PIPELINE_FLAGS,

    // Callbacks for SSE output
    onStreamChunk: (chunk) => {
      if (!res.writableEnded && !res.destroyed) {
        try {
          res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
        } catch (writeErr) {
          console.warn('[Stream] Failed to write chunk:', writeErr.message);
        }
      }
    },
    // Reasoning goes to its own panel, never the answer bubble. It arrives
    // before the first answer token, so this is usually what breaks the silence
    // on a slow model.
    onReasoningChunk: (chunk) => {
      if (!res.writableEnded && !res.destroyed) {
        try {
          res.write(`data: ${JSON.stringify({ type: 'reasoning', text: chunk })}\n\n`);
        } catch (writeErr) {
          console.warn('[Stream] Failed to write reasoning chunk:', writeErr.message);
        }
      }
    },
    // A round that streamed a preamble then turned out to be a tool call: the
    // text on screen is not part of the answer, so tell the client to drop it.
    onStreamReset: () => {
      if (!res.writableEnded && !res.destroyed) {
        try {
          res.write(`data: ${JSON.stringify({ type: 'reset' })}\n\n`);
        } catch (writeErr) {
          console.warn('[Stream] Failed to write reset event:', writeErr.message);
        }
      }
    },
    onToolStatus: (statusEvent) => {
      if (!res.writableEnded && !res.destroyed) {
        try {
          res.write(`data: ${JSON.stringify(statusEvent)}\n\n`);
        } catch (writeErr) {
          console.warn('[Stream] Failed to write tool status event:', writeErr.message);
        }
      }
    },
  });

  // ── Handle pipeline error ──────────────────────────────────
  if (result.err) {
    // If stream was already aborted by client, just return
    if (result.errorType === 'aborted' || res.writableEnded || res.destroyed) return;

    console.error('[Stream] Error:', result.err.message);
    // The pipeline classifies its own failures (unknown model, over-budget query,
    // unowned topic). Only fall back to classifyError for provider-level errors,
    // which is all it knows how to read.
    const { errorType, userMessage: errorMessage } = result.errorType && result.userMessage
      ? { errorType: result.errorType, userMessage: result.userMessage }
      : classifyError(result.err?.message);

    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }

    try {
      // The raw provider error is logged server-side but never shipped to the
      // client: it can embed internal details (API key hints, provider messages,
      // request bodies). `errorMessage` above is the sanitized, user-safe text.
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: errorMessage,
        errorType,
        suggestedModels: result.suggestedModels || undefined,
        recommendedModelId: result.recommendedModelId || undefined,
        failedModelId: modelId,
      })}\n\n`);
    } catch (writeErr) {
      console.warn('[Stream] Failed to write SSE error response:', writeErr.message);
    }

    try { res.end(); } catch { /* ignore */ }
    return;
  }

  if (result.queryCacheHit && result.finalReply && !res.writableEnded && !res.destroyed) {
    res.write(`data: ${JSON.stringify({ type: 'chunk', text: result.finalReply })}\n\n`);
  }

  // ── Send completion event ──────────────────────────────────
  res.write(`data: ${JSON.stringify({
    type: 'done',
    tokensUsed: result.billableTokens,
    cacheCreationTokens: result.cacheCreationTokens,
    cacheReadTokens: result.cacheReadTokens,
    cacheHit: result.cacheHit,
    orchestratorBrain: result.orchestratorBrain ? {
      enabled: true,
      traceId: result.orchestratorBrain.traceId,
      steps: result.orchestratorBrain.dashboard?.totalSteps,
      status: result.orchestratorBrain.dashboard?.status,
    } : undefined,
    model: result.effectiveModelConfig?.label,
    topicId: result.resolvedTopicId || null,
    assistantMessageId: result.savedAssistantMessageId || null,
    responseTime: Date.now() - startTime,
    persistError: result.persistError ? 'Failed to save messages' : undefined,
    generatedFiles: result.generatedMediaFiles?.length > 0 ? result.generatedMediaFiles : undefined,
    citations: result.citations?.length > 0 ? result.citations : undefined,
  })}\n\n`);

  if (!res.writableEnded && !res.destroyed) {
    try { res.end(); } catch (endErr) { console.warn('[Stream] Failed to close response:', endErr.message); }
  }
});

module.exports = router;


