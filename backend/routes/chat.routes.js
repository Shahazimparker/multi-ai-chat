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
const { CHAT_SEMANTIC_CACHE_THRESHOLD } = require('../config/chatRuntime.config');
const { getProviderModels } = require('../services/modelCatalog.service');
const supabase = require('../config/supabase');
const chatService = require('../services/chat.service');
const {
  buildFileContext,
  runToolLoop,
  stripToolTags,
  buildFallbackDbReply,
  classifyError,
} = chatService;
const { getCachedResponse, getSemanticCachedResponse } = require('../services/cache.service');
const { buildRAGContext, embedText } = require('../services/rag.service');
const { buildContextMessages, maybeCompressQuery } = require('../services/context.service');
const { listUserFiles } = require('../services/fileUpload.service');
const { calculateBillableTokens } = require('../services/tokenAccounting.service');
const { createPromptBudget, estimateTokens, estimateMessagesTokens } = require('../services/tokenBudget.service');
const { logAnalytics } = require('../services/analytics.service');


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
router.post('/message', chatLimiter, optionalAuth, tokenCheck, sanitizeBody(['message', 'image', 'providerModelId', 'modelId', 'memoryMode']), sendMessage);
/**
 * POST /api/chat/stream
 * Streaming response using Server-Sent Events
 */
router.post('/stream', chatLimiter, optionalAuth, tokenCheck, sanitizeBody(['message', 'image', 'providerModelId', 'modelId', 'memoryMode']), async (req, res) => {
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
    history, // client-provided conversation history (used for anonymous sessions)
  } = req.body;

  const user = req.user;
  const isAnonymous = !user;
  const abortController = new AbortController();
  let resolvedTopicId = topicId;

  try {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Send initial connection confirmation
    res.write('data: {"status": "connected"}\n\n');

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
    const cached = await getCachedResponse(message, modelId, user?.id, topicId);
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
    const estimatedInputTokens = estimateTokens(message);
    const promptBudget = createPromptBudget(modelConfig);

    let ragContext = '';
    let fileResults = [];
    let totalFileCount = 0;

    // Compress long queries (moved before embedding for reuse)
    const compressResult = await maybeCompressQuery(message, abortController.signal);
    const streamQuery = typeof compressResult === 'string' ? compressResult : compressResult.query;
    const compressTokens = typeof compressResult === 'string' ? 0 : (compressResult.tokensUsed || 0);
    let totalEmbeddingTokens = 0;

    // Generate query embedding ONCE — reused for semantic cache + RAG
    let queryVector = null;
    if (ragEnabled) {
      if (abortController.signal.aborted) throw { name: 'AbortError' };
      const embedResult = await embedText(streamQuery, 'openrouter', 3, abortController.signal, user?.id);
      if (embedResult) {
        queryVector = embedResult.vector;
        totalEmbeddingTokens += embedResult.tokensUsed;
      }

      // Semantic cache lookup (same embedding vector)
      {
        const semanticCachedReply = await getSemanticCachedResponse(queryVector, modelId, CHAT_SEMANTIC_CACHE_THRESHOLD, user?.id, topicId);
        if (semanticCachedReply) {
          res.write(`data: ${JSON.stringify({
            type: 'cached',
            reply: semanticCachedReply,
            tokensUsed: 0,
            cacheHit: true,
            topicId: topicId || null,
          })}\n\n`);
          res.write('data: {"type": "done"}\n\n');
          res.end();

          // Log analytics asynchronously
          logAnalytics({
            userId: user?.id, query: message, modelId, tokensUsed: 0,
            isAnonymous, cacheHit: true, responseTimeMs: Date.now() - startTime,
          }).catch(err => console.error('[Analytics] Error:', err));
          return;
        }
      }

      // RAG context — reuse same queryVector (no internal embedding call)
      if (topicId) {
        ragContext = await buildRAGContext(
          streamQuery,
          'openrouter',
          abortController.signal,
          queryVector,
          { tokenBudget: promptBudget.ragTokens, topicId, userId: user?.id }
        );

        // HYBRID: Get ALL files for the topic (no limit, no similarity filter)
        const fileData = await listUserFiles(user?.id, topicId);
        const normalizedFileData = Array.isArray(fileData)
          ? { files: fileData, totalCount: fileData.length }
          : (fileData || {});
        fileResults = normalizedFileData.files || [];
        totalFileCount = normalizedFileData.totalCount || fileResults.length;
      }
    }

    const { context: historyContext, summaryTokens: historySummaryTokens, _debug } = await buildContextMessages(
      streamQuery,
      topicId,
      { memoryMode, historyLimit, userId: user?.id },
      abortController.signal
    );


    // Log dynamic budget info
    if (_debug) {
      console.log(`[Dynamic Budget] Complexity: ${_debug.complexity.toFixed(2)}, Turns: ${_debug.turnCount}, Allocated: ${_debug.allocatedBudget} tokens`);
    }

    // ── HYBRID APPROACH: File names only, tools for content ──
    const fileContext = buildFileContext(fileResults, totalFileCount);


    const generalToolsDirective = `\n\n## General Tools\nYou have access to the following tools. To use them, output EXACTLY the tags below:\n1. Web Search: [WEB_SEARCH:query="your search query"]\n2. Execute JS Code: [EXECUTE_CODE]console.log("hello");[/EXECUTE_CODE]\nWait for the tool result to be provided in the next user message before answering.`;

    // Build AI messages
    const systemPrompt = `You are a helpful AI assistant.${ragContext ? '\n\n[CONTEXT FROM DOCUMENTS]\n' + ragContext : ''}${fileContext ? '\n\n' + fileContext : ''}${generalToolsDirective}`;
    const aiMessages = [
      { role: 'system', content: systemPrompt },
    ];
    // Add history context if it exists
    if (historyContext && historyContext.length > 0) {
      aiMessages.push(...historyContext);
    } else if (history && Array.isArray(history) && history.length > 0) {
      // For anonymous sessions: use client-provided history
      aiMessages.push(...history);
    }
    const userContent = image
      ? [
        { type: 'text', text: message || 'Analyze this image' },
        { type: 'image_url', image_url: { url: image } }
      ]
      : message;
    aiMessages.push({ role: 'user', content: userContent });
    const promptTokens = estimateMessagesTokens(aiMessages);
    let totalAITokens = 0;

    // ── Tool-call loop: AI can search files, request full content, or query business DB ──
    let cacheCreationTokens = 0, cacheReadTokens = 0;
    let finalReply = '';
    let billableTokens = 0;
    let dbQueried = false;
    let lastDbResultBlock = '';
    let consecutiveZeroResults = 0;
    let dbQueryCount = 0;
    const fetchedSchemaTables = new Set();
    const MAX_TOOL_ROUNDS = 6;
    const loopResult = await runToolLoop({
      effectiveModelConfig,
      aiMessages,
      abortController,
      processToolCallArgs: {
        user,
        topicId,
        abortController,
        fetchedSchemaTables,
        onStatus: (statusEvent) => {
          if (!res.writableEnded && !res.destroyed) {
            try {
              res.write(`data: ${JSON.stringify(statusEvent)}\n\n`);
            } catch (writeErr) {
              console.warn('[Stream] Failed to write tool status event:', writeErr.message);
            }
          }
        },
      },
      effectiveDbOnly: false,
      promptBudget,
      maxToolRounds: MAX_TOOL_ROUNDS,
      loggerPrefix: 'Stream Tool',
      getNudgeSourceText: () => message,
      onAfterDispatch: async ({ result }) => {
        cacheCreationTokens += result.cacheCreationTokens || 0;
        cacheReadTokens += result.cacheReadTokens || 0;
      },
    });
    if (loopResult.aborted) return;
    finalReply = loopResult.finalReply;
    dbQueried = loopResult.dbQueried;
    lastDbResultBlock = loopResult.lastDbResultBlock;
    consecutiveZeroResults = loopResult.consecutiveZeroResults;
    dbQueryCount = loopResult.dbQueryCount;
    totalAITokens += loopResult.totalAITokens || 0;
    totalEmbeddingTokens += loopResult.totalEmbeddingTokens || 0;

    // Strip leftover tool-call syntax
    finalReply = stripToolTags(finalReply);

    // Fallback: only if AI literally gave us nothing usable after stripping
    if (dbQueried && lastDbResultBlock && consecutiveZeroResults < 4 && (!finalReply || finalReply.trim().length < 5)) {
      finalReply = buildFallbackDbReply(lastDbResultBlock);
    }

    billableTokens = calculateBillableTokens({
      totalAITokens,
      promptTokens,
      finalReply,
      totalEmbeddingTokens,
      estimatedInputTokens,
      compressTokens,
      historySummaryTokens,
    });

    // Send streamed response in chunks — section-aware speed
    // Text → slow (human-readable), Tables/Code blocks → fast
    const contentLen = finalReply.length;
    // Parse content into sections: normal text vs data blocks (tables, code)
    const SECTIONS = [];
    const dataBlockRE = /```[\s\S]*?```|(?:^\|.+\|\s*$(?:\n\|[-: |]+\|\s*$(?:\n\|.+\|\s*$)*))/gm;
    let lastIdx = 0;
    let match;

    // Reset lastIndex
    dataBlockRE.lastIndex = 0;

    while ((match = dataBlockRE.exec(finalReply)) !== null) {
      // Text before this block
      if (match.index > lastIdx) {
        SECTIONS.push({ type: 'text', content: finalReply.slice(lastIdx, match.index) });
      }
      SECTIONS.push({ type: 'data', content: match[0] });
      lastIdx = match.index + match[0].length;
    }
    // Remaining text after last block
    if (lastIdx < contentLen) {
      SECTIONS.push({ type: 'text', content: finalReply.slice(lastIdx) });
    }

    // If no data blocks at all, treat everything as one text section
    if (SECTIONS.length === 0) {
      SECTIONS.push({ type: 'text', content: finalReply });
    }

    let sentChars = 0;

    for (const section of SECTIONS) {
      if (abortController.signal.aborted) break;

      const isData = section.type === 'data';

      if (isData) {
        // 📦 Data blocks (tables/code fences) → instantly in one shot
        res.write(`data: ${JSON.stringify({
          type: 'chunk',
          text: section.content,
          progress: Math.round(((sentChars + section.content.length) / contentLen) * 100)
        })}\n\n`);
        sentChars += section.content.length;
        // Brief pause between sections so text→data boundary is perceptible
        await new Promise(r => setTimeout(r, 20));
      } else {
        // 💬 Text → slow, human-readable typing
        const chunkSize = 2 + Math.floor(Math.random() * 3); // 2-4 chars
        let sPos = 0;
        const secLen = section.content.length;

        while (sPos < secLen) {
          if (abortController.signal.aborted) break;

          const size = Math.min(chunkSize, secLen - sPos);
          const actualSize = size + (Math.random() < 0.3 ? 1 : 0);
          const chunk = section.content.slice(sPos, sPos + actualSize);

          res.write(`data: ${JSON.stringify({
            type: 'chunk',
            text: chunk,
            progress: Math.round((sentChars / contentLen) * 100)
          })}\n\n`);

          sPos += actualSize;
          sentChars += actualSize;

          // Variable delay: pause after punctuation
          const lastCh = chunk[chunk.length - 1];
          let delay = 50 + Math.random() * 40; // 50-90ms default
          if (lastCh === '\n') delay = 150 + Math.random() * 100;   // 150-250ms
          else if ('.!?'.includes(lastCh)) delay = 120 + Math.random() * 80; // 120-200ms
          else if (',;:'.includes(lastCh)) delay = 60 + Math.random() * 40;  // 60-100ms
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    // ✅ CREATE NEW TOPIC IF NEEDED (BEFORE persistence)
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
    // ✅ SAVE MESSAGES TO DB BEFORE SENDING DONE (ensure consistency)
    let persistError = null;
    if (!isAnonymous && resolvedTopicId) {
      const { error: msgError } = await supabase.from('messages').insert([
        {
          topic_id: resolvedTopicId,
          user_id: user.id,
          role: 'user',
          content: message,
          model: modelId,
          tokens_used: estimatedInputTokens,
        },
        {
          topic_id: resolvedTopicId,
          user_id: user.id,
          role: 'assistant',
          content: finalReply || '',
          model: modelId,
          tokens_used: billableTokens,
        }
      ]);

      if (msgError) {
        persistError = msgError;
        console.error('[Stream] Message insert error:', msgError.message);
      } else {
        // Update topic timestamp + model (reflects latest model used)
        const { error: topicError } = await supabase
          .from('topics')
          .update({ updated_at: new Date().toISOString(), model: modelId })
          .eq('id', resolvedTopicId);

        if (topicError) {
          console.error('[Stream] Topic update error:', topicError.message);
        }

        // ✅ UPDATE USER TOKEN COUNT ONLY IF MESSAGES SAVED SUCCESSFULLY
        if (user) {
          const { error: userError } = await supabase.rpc('increment_user_tokens', { user_id: user.id, token_amount: billableTokens });

          if (userError) {
            console.error('[Stream] User update error:', userError.message);
          }
        }
      }
    }
    // ✅ SEND COMPLETION RESPONSE AFTER PERSISTENCE ATTEMPT
    res.write(`data: ${JSON.stringify({
      type: 'done',
      tokensUsed: billableTokens,
      cacheCreationTokens,
      cacheReadTokens,
      cacheHit: cacheReadTokens > 0,
      model: effectiveModelConfig.label,
      topicId: resolvedTopicId || null,
      responseTime: Date.now() - startTime,
      persistError: persistError ? 'Failed to save messages' : undefined,
    })}\n\n`);
    console.log(`[Stream TokenTracking] AI=${totalAITokens} Embedding=${totalEmbeddingTokens} InputMsg=${estimatedInputTokens} Compress=${compressTokens} Summary=${historySummaryTokens} Total=${billableTokens}`);

    if (!res.writableEnded && !res.destroyed) {
      try {
        res.end();
      } catch (endErr) {
        console.warn('[Stream] Failed to close response:', endErr.message);
      }
    }

    // Log analytics asynchronously (fire-and-forget is fine here)
    logAnalytics({
      userId: user?.id,
      query: message,
      modelId,
      tokensUsed: billableTokens,
      isAnonymous,
      cacheHit: cacheReadTokens > 0,
      responseTimeMs: Date.now() - startTime,
    }).catch(err => console.error('[Analytics] Error:', err));
  } catch (err) {
    console.error('[Stream] Error:', err);

    // If client already gone, don't write anything
    if (res.writableEnded || res.destroyed) return;

    const { errorType, userMessage: errorMessage } = classifyError(err?.message);

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
        originalError: err?.message || ''
      })}\n\n`);
    } catch (writeErr) {
      console.warn('[Stream] Failed to write SSE error response:', writeErr.message);
      return;
    }

    try {
      res.end();
    } catch (endErr) {
      console.warn('[Stream] Failed to close errored response:', endErr.message);
    }
  }
});

module.exports = router;


