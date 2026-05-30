// ============================================================
// FILE: backend/routes/chat.routes.js
// PURPOSE: Chat endpoints — auth optional (anonymous allowed)
// ============================================================

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { sendMessage } = require('../controllers/chat.controller');
const { tokenCheck } = require('../middleware/tokenCheck');
const { sanitizeBody } = require('../middleware/sanitize');
const { MODELS } = require('../config/models');
const { getProviderModels } = require('../services/modelCatalog.service');
const { classifyError } = require('../services/chatCleanup.service');
const { CANONICAL_CHAT_PIPELINE_FLAGS, runChatPipeline } = require('../services/chatPipeline.service');

const getCookieValue = (cookieHeader, key) => {
  if (!cookieHeader) return null;
  const parts = String(cookieHeader).split(';');
  for (const part of parts) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === key) return decodeURIComponent(rest.join('='));
  }
  return null;
};

// Rate limit: 30 requests/minute per IP
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests. Please slow down.' },
});

// Optional auth middleware (allows anonymous)
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  const cookieToken = getCookieValue(req.headers.cookie, 'auth_token');
  const token = bearerToken || cookieToken;
  if (!token) return next();

  try {
    const jwt = require('jsonwebtoken');
    const supabase = require('../config/supabase');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('id', decoded.userId)
      .single();

    req.user = user || null;
  } catch {
    req.user = null; // treat as anonymous on invalid token
  }
  next();
};

// GET /api/chat/models — public list of available models
router.get('/models', (req, res) => {
  const models = Object.entries(MODELS).map(([id, cfg]) => ({
    id,
    label: cfg.label,
    provider: cfg.provider,
    paid: cfg.paid,
    unified: !!cfg.unified,
    models: cfg.models || [],
  }));
  res.json({ models });
});
router.get('/provider-models/:provider', async (req, res) => {
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

const chatBodySanitizer = sanitizeBody(['message', 'image', 'providerModelId', 'modelId', 'memoryMode']);

// POST /api/chat/message — legacy JSON compatibility; /stream is the canonical chat path
router.post('/message', chatLimiter, optionalAuth, tokenCheck, chatBodySanitizer, sendMessage);
/**
 * POST /api/chat/stream
 * Canonical chat endpoint using Server-Sent Events
 */
router.post('/stream', chatLimiter, optionalAuth, tokenCheck, chatBodySanitizer, async (req, res) => {
  req.setTimeout(0);
  res.setTimeout(0);
  const startTime = Date.now();
  const {
    message,
    image,
    topicId,
    modelId = 'claude-sonnet',
    providerModelId,
    memoryMode = 'summarized',
    historyLimit = 5,
    ragEnabled = false,
    history,
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
    history,
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
    const { errorType, userMessage: errorMessage } = classifyError(result.err?.message);

    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }

    try {
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: errorMessage,
        errorType,
        originalError: result.err?.message || '',
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
    responseTime: Date.now() - startTime,
    persistError: result.persistError ? 'Failed to save messages' : undefined,
    generatedFiles: result.generatedMediaFiles?.length > 0 ? result.generatedMediaFiles : undefined,
  })}\n\n`);

  if (!res.writableEnded && !res.destroyed) {
    try { res.end(); } catch (endErr) { console.warn('[Stream] Failed to close response:', endErr.message); }
  }
});

module.exports = router;


