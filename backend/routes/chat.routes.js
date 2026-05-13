// ============================================================
// FILE: backend/routes/chat.routes.js
// PURPOSE: Chat endpoints — auth optional (anonymous allowed)
// ============================================================

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { sendMessage } = require('../controllers/chat.controller');
const { requireAuth } = require('../middleware/auth');
const { tokenCheck } = require('../middleware/tokenCheck');
const { MODELS } = require('../config/models');
const { getProviderModels } = require('../services/modelCatalog.service');
const supabase = require('../config/supabase');


// Rate limit: 30 requests/minute per IP
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests. Please slow down.' },
});

// Optional auth middleware (allows anonymous)
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return next(); // anonymous

  try {
    const jwt = require('jsonwebtoken');
    const supabase = require('../config/supabase');
    const token = authHeader.split(' ')[1];
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

// POST /api/chat/message
router.post('/message', chatLimiter, optionalAuth, tokenCheck, sendMessage);
/**
 * POST /api/chat/stream
 * Streaming response using Server-Sent Events
 */
router.post('/stream', chatLimiter, optionalAuth, tokenCheck, async (req, res) => {
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
  } = req.body;

  const user = req.user;
  const isAnonymous = !user;
  const abortController = new AbortController();
  let resolvedTopicId = topicId;  // ✅ MOVE HERE - outside try block

  try {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Send initial connection confirmation
    res.write('data: {"status": "connected"}\n\n');

    // Import all the same services as chat endpoint
    const { MODELS } = require('../config/models');
    const { dispatchToAI } = require('../services/ai/dispatcher.service');
    const { compressPrompt } = require('../services/compress.service');
    const { getCachedResponse } = require('../services/cache.service');
    const { buildRAGContext, embedText } = require('../services/rag.service');
    const { buildContextMessages } = require('../services/context.service');
    const { searchUserFilesRAG } = require('../services/fileUpload.service');
    const {
      createPromptBudget,
      trimTextByTokens,
      estimateTokens,
      estimateMessagesTokens,
    } = require('../services/tokenBudget.service');

    const modelConfig = MODELS[modelId];
    const effectiveModelConfig = providerModelId
      ? { ...modelConfig, model: providerModelId }
      : modelConfig;
    if (!modelConfig) {
      res.write(`data: ${JSON.stringify({ error: 'Unknown model' })}\n\n`);
      res.end();
      return;
    }

    // Check cache first (if hit, send cached response)
    const cached = await getCachedResponse(message, user?.id, topicId, modelId);
    if (cached) {
      res.write(`data: ${JSON.stringify({
        type: 'cached',
        reply: cached,
        tokensUsed: 0,
        cacheHit: true
      })}\n\n`);
      res.write('data: {"type": "done"}\n\n');
      res.end();
      return;
    }

    // Build context (same as regular endpoint)
    // Build context (same as regular endpoint)
    const promptBudget = createPromptBudget(modelConfig);

    let ragContext = '';
    let fileResults = [];

    if (ragEnabled) {
      // Check if user has uploaded files for this topic
      const { count, error: countError } = await supabase
        .from('uploaded_files_rag')
        .select('id', { count: 'exact' })
        .eq('user_id', user?.id)
        .eq('topic_id', topicId);

      if (count > 0) {
        console.log('[RAG] Files found:', count);

        ragContext = await buildRAGContext(
          message,
          'openrouter',
          abortController.signal,
          null,
          { tokenBudget: promptBudget.ragTokens }
        );
        console.log('[RAG] Context:', ragContext.slice(0, 100));

        fileResults = await searchUserFilesRAG(
          message,
          user?.id,
          topicId,
          abortController.signal,
          'openrouter'
        );
        console.log('[RAG] FileResults count:', fileResults?.length);
        console.log('[RAG] FileResults:', JSON.stringify(fileResults, null, 2));

      }
    }

    const { context: historyContext, _debug } = await buildContextMessages(
      message,
      topicId,
      { memoryMode, historyLimit, tokenBudget: promptBudget.historyTokens, userId: user?.id },
      abortController.signal
    );


    // Log dynamic budget info
    if (_debug) {
      console.log(`[Dynamic Budget] Complexity: ${_debug.complexity.toFixed(2)}, Turns: ${_debug.turnCount}, Allocated: ${_debug.allocatedBudget} tokens`);
    }

    const fileContext = fileResults.length > 0
      ? trimTextByTokens(
        `[UPLOADED FILE CODE]\n${fileResults
          .map(r => `File: ${r.file_name}\n${r.chunk_text}`)
          .join('\n\n---\n')}\n[END ANALYSES]\n`,
        promptBudget.fileTokens
      )
      : '';


    // Build AI messages
    const systemPrompt = `You are a helpful AI assistant.${ragContext ? '\n\n[CONTEXT FROM DOCUMENTS]\n' + ragContext : ''}${fileContext ? '\n\n' + fileContext : ''}`;
    const aiMessages = [
      { role: 'system', content: systemPrompt },
    ];
    // Add history context if it exists
    if (historyContext && historyContext.length > 0) {
      aiMessages.push(...historyContext);
    }
    const userContent = image
      ? [
        { type: 'text', text: message || 'Analyze this image' },
        { type: 'image_url', image_url: { url: image } }
      ]
      : message;
    aiMessages.push({ role: 'user', content: userContent });
    const promptTokens = estimateMessagesTokens(aiMessages);

    // Get streaming response
    const { text: reply, tokensUsed, cacheCreationTokens = 0, cacheReadTokens = 0 } = await dispatchToAI(effectiveModelConfig, aiMessages, abortController.signal);
    const billableTokens = Math.max(tokensUsed || 0, promptTokens + estimateTokens(reply));


    // Send streamed response in chunks
    const chunkSize = 10; // Send 10 chars at a time (adjust as needed)
    let sentChars = 0;

    while (sentChars < reply.length) {
      if (abortController.signal.aborted) break;

      const chunk = reply.slice(sentChars, sentChars + chunkSize);
      res.write(`data: ${JSON.stringify({
        type: 'chunk',
        text: chunk,
        progress: Math.round((sentChars / reply.length) * 100)
      })}\n\n`);

      sentChars += chunkSize;
      // Small delay for realistic streaming effect
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    // ✅ CREATE NEW TOPIC IF NEEDED (BEFORE res.end())
    if (!isAnonymous && !resolvedTopicId) {
      const topicTitle = message.trim().slice(0, 60) + (message.length > 60 ? '...' : '');
      const { data: newTopic, error: topicError } = await supabase
        .from('topics')
        .insert({ user_id: user.id, title: topicTitle, model: modelId })
        .select('id')
        .single();

      if (topicError) {
        console.error('[Stream] Topic creation failed:', topicError.message);
      } else {
        resolvedTopicId = newTopic?.id;
        console.log('[Stream] New topic created:', resolvedTopicId);
      }
    }
    // ✅ SEND COMPLETION RESPONSE FIRST (with topicId)
    res.write(`data: ${JSON.stringify({
      type: 'done',
      tokensUsed: billableTokens,
      cacheCreationTokens,
      cacheReadTokens,
      cacheHit: cacheReadTokens > 0,
      model: effectiveModelConfig.label,
      topicId: resolvedTopicId || null,
      responseTime: Date.now() - startTime
    })}\n\n`);

    if (!res.writableEnded && !res.destroyed) {
      try { res.end(); } catch { }
    }
    // ✅ THEN SAVE MESSAGES ASYNCHRONOUSLY (fire and forget)
    if (!isAnonymous && resolvedTopicId) {
      supabase.from('messages').insert([
        {
          topic_id: resolvedTopicId,
          user_id: user.id,
          role: 'user',
          content: message,
          model: modelId,
          tokens_used: 0,
        },
        {
          topic_id: resolvedTopicId,
          user_id: user.id,
          role: 'assistant',
          content: reply,
          model: modelId,
          tokens_used: billableTokens,
        }
      ])
        .then(({ error }) => {
          if (error) console.error('[Stream] Message insert error:', error);
        })
        .catch(err => console.error('[Stream] Message insert error:', err));

      // Update topic timestamp
      supabase
        .from('topics')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', resolvedTopicId)
        .then(({ error }) => {
          if (error) console.error('[Stream] Topic update error:', error);
        })
        .catch(err => console.error('[Stream] Topic update error:', err));
    }

    // ✅ UPDATE USER TOKEN COUNT ASYNCHRONOUSLY
    if (user) {
      supabase
        .from('users')
        .update({ used_tokens: user.used_tokens + billableTokens })
        .eq('id', user.id)
        .then(({ error }) => {
          if (error) console.error('[Stream] User update error:', error);
        })
        .catch(err => console.error('[Stream] User update error:', err));
    }

    // Log analytics asynchronously
    const { logAnalytics } = require('../services/analytics.service');
    logAnalytics({
      userId: user?.id,
      query: message,
      modelId,
      tokensUsed,
      isAnonymous,
      cacheHit: cacheReadTokens > 0,
      responseTimeMs: Date.now() - startTime,
    }).catch(err => console.error('[Analytics] Error:', err));
  } catch (err) {
    console.error('[Stream] Error:', err);

    // If client already gone, don't write anything
    if (res.writableEnded || res.destroyed) return;

    let errorMessage = 'Something went wrong';
    let errorType = 'general';

    const msg = String(err?.message || '');
    if (msg.includes('429') || msg.includes('quota')) {
      errorMessage = 'Quota exceeded. Please use another model.';
      errorType = 'quota';
    } else if (msg.includes('ECONNREFUSED') || msg.includes('Connection')) {
      errorMessage = 'Connection failed. Please check your internet.';
      errorType = 'connection';
    } else if (msg.includes('ENOTFOUND') || msg.includes('DNS')) {
      errorMessage = 'Backend server not responding. Please try again.';
      errorType = 'server';
    } else if (msg.includes('timeout')) {
      errorMessage = 'Request timeout. Please try again.';
      errorType = 'timeout';
    }

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
        originalError: msg
      })}\n\n`);
    } catch {
      return;
    }

    try { res.end(); } catch { }
  }
});

module.exports = router;