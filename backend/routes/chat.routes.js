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
    history, // client-provided conversation history (used for anonymous sessions)
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
    const { searchUserFilesRAG, getFileContent, listUserFiles } = require('../services/fileUpload.service');
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
    let totalFileCount = 0;

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
          { tokenBudget: promptBudget.ragTokens, topicId }
        );
        console.log('[RAG] Context:', ragContext.slice(0, 100));

        // HYBRID: Get ALL files for the topic (no limit, no similarity filter)
        const fileData = await listUserFiles(user?.id, topicId);
        fileResults = fileData.files || [];
        totalFileCount = fileData.totalCount || 0;
        console.log('[RAG] FileResults count:', fileResults.length, 'total:', totalFileCount);

      }
    }

    const { context: historyContext, _debug } = await buildContextMessages(
      message,
      topicId,
      { memoryMode, historyLimit, userId: user?.id },
      abortController.signal
    );


    // Log dynamic budget info
    if (_debug) {
      console.log(`[Dynamic Budget] Complexity: ${_debug.complexity.toFixed(2)}, Turns: ${_debug.turnCount}, Allocated: ${_debug.allocatedBudget} tokens`);
    }

    // ── HYBRID APPROACH: File names only, tools for content ──
    const fileCountNote = totalFileCount > fileResults.length
      ? `\n(Showing ${fileResults.length} of ${totalFileCount} total files — use SEARCH_FILES to find older ones)`
      : '';
    const fileContext = fileResults.length > 0
      ? `[AVAILABLE UPLOADED FILES]\n${fileResults
          .map(r => `- ${r.file_name} (id: ${r.file_id})`)
          .join('\n')}${fileCountNote}\n[END UPLOADED FILES]\n\n` +
        `You have access to two tools for uploaded files:\n` +
        `1. SEARCH_FILES — use when the user asks what a file contains or which file has specific data. ` +
        `Respond with: [SEARCH_FILES:query=<search text>] and I will return brief snippets of matching files.\n` +
        `2. GET_FILE — use when you need the full content of a specific file. ` +
        `Respond with: [GET_FILE:id=<file_id>] and I will inject the full content.`
      : '';


    // Build AI messages
    const systemPrompt = `You are a helpful AI assistant.${ragContext ? '\n\n[CONTEXT FROM DOCUMENTS]\n' + ragContext : ''}${fileContext ? '\n\n' + fileContext : ''}`;
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

    // ── Tool-call loop: AI can request file content, we fetch it and re-invoke ──
    let reply, tokensUsed, cacheCreationTokens = 0, cacheReadTokens = 0;
    let finalReply = '';
    let billableTokens = 0;

    const MAX_TOOL_ROUNDS = 3;
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await dispatchToAI(effectiveModelConfig, aiMessages, abortController.signal);
      reply = result.text;
      tokensUsed = result.tokensUsed;
      cacheCreationTokens = result.cacheCreationTokens || 0;
      cacheReadTokens = result.cacheReadTokens || 0;

      if (abortController.signal.aborted) return;

      // Check for SEARCH_FILES tool call
      const searchMatch = reply.match(/\[SEARCH_FILES:query=([^\]]+)\]/);
      if (searchMatch) {
        const query = searchMatch[1].trim();
        console.log(`[Stream Tool] AI searching files: query="${query}"`);

        const searchResults = await searchUserFilesRAG(query, user?.id, topicId, abortController.signal);
        const resultBlock = searchResults.length > 0
          ? `[SEARCH RESULTS for "${query}"]\n${searchResults
              .map(r => `- ${r.file_name} (id: ${r.file_id}): ${r.chunk_text.slice(0, 300)}`)
              .join('\n')}\n[END SEARCH RESULTS]`
          : `[SEARCH RESULTS for "${query}"]\nNo matching files found.\n[END SEARCH RESULTS]`;

        aiMessages.push({ role: 'assistant', content: reply.replace(searchMatch[0], '').trim() || `[Searching files for "${query}"]` });
        aiMessages.push({ role: 'user', content: resultBlock });
        continue;
      }

      // Check for GET_FILE tool call
      const getFileMatch = reply.match(/\[GET_FILE:id=([^\]]+)\]/);
      if (getFileMatch) {
        const fileId = getFileMatch[1].trim();
        console.log(`[Stream Tool] AI requested file content: id=${fileId}`);

        const fileData = await getFileContent(fileId, user?.id, topicId);
        if (!fileData) {
          aiMessages.push({ role: 'assistant', content: reply });
          aiMessages.push({ role: 'user', content: `[Tool Result] File with id "${fileId}" not found or access denied.` });
          continue;
        }

        const fileContent = fileData.original_content || fileData.llm_analysis || '[No content available]';
        const contentBlock = `[FILE CONTENT: ${fileData.file_name}]\n\`\`\`\n${fileContent}\n\`\`\`\n[END FILE CONTENT]\n\nNow answer the user's question based on this file content. Be concise and accurate.`;

        aiMessages.push({ role: 'assistant', content: reply.replace(getFileMatch[0], '').trim() || `[Requesting file: ${fileData.file_name}]` });
        aiMessages.push({ role: 'user', content: contentBlock });
        continue;
      }

      // No tool call — done
      finalReply = reply;
      billableTokens = (tokensUsed && tokensUsed > 0) ? tokensUsed : promptTokens + estimateTokens(finalReply);
      break;
    }

    if (!finalReply) {
      finalReply = reply || '';
      billableTokens = (tokensUsed && tokensUsed > 0) ? tokensUsed : promptTokens + estimateTokens(finalReply);
    }

    // Send streamed response in chunks
    const chunkSize = 10;
    let sentChars = 0;

    while (sentChars < finalReply.length) {
      if (abortController.signal.aborted) break;

      const chunk = finalReply.slice(sentChars, sentChars + chunkSize);
      res.write(`data: ${JSON.stringify({
        type: 'chunk',
        text: chunk,
        progress: Math.round((sentChars / finalReply.length) * 100)
      })}\n\n`);

      sentChars += chunkSize;
      await new Promise(resolve => setTimeout(resolve, 10));
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
          tokens_used: 0,
        },
        {
          topic_id: resolvedTopicId,
          user_id: user.id,
          role: 'assistant',
          content: finalReply || reply || '',
          model: modelId,
          tokens_used: billableTokens,
        }
      ]);

      if (msgError) {
        persistError = msgError;
        console.error('[Stream] Message insert error:', msgError.message);
      } else {
        // Only update topic timestamp if messages saved
        const { error: topicError } = await supabase
          .from('topics')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', resolvedTopicId);

        if (topicError) {
          console.error('[Stream] Topic update error:', topicError.message);
        }

        // ✅ UPDATE USER TOKEN COUNT ONLY IF MESSAGES SAVED SUCCESSFULLY
        if (user) {
          const { error: userError } = await supabase
            .from('users')
            .update({ used_tokens: user.used_tokens + billableTokens })
            .eq('id', user.id);

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

    if (!res.writableEnded && !res.destroyed) {
      try { res.end(); } catch { }
    }

    // Log analytics asynchronously (fire-and-forget is fine here)
    const { logAnalytics } = require('../services/analytics.service');
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