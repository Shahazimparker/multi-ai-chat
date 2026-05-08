// ============================================================
// FILE: backend/controllers/chat.controller.js
// PURPOSE: Core chat logic — processes user messages through:
//   1. Prompt compression    (remove filler words)
//   2. Cache check           (return if repeated query)
//   3. RAG context injection (relevant knowledge docs)
//   4. History context       (last 10 msgs if same topic)
//   5. AI dispatch           (call correct AI provider)
//   6. Token tracking        (update user quota)
//   7. Save to DB            (persist for logged-in users)
//   8. Analytics logging     (all queries tracked)
// ============================================================

const supabase = require('../config/supabase');
const { MODELS } = require('../config/models');
const { dispatchToAI } = require('../services/ai/dispatcher.service');
const { compressPrompt } = require('../services/compress.service');
const { getCachedResponse, setCachedResponse } = require('../services/cache.service');
const { buildRAGContext, embedText } = require('../services/rag.service');
const { buildContextMessages, maybeCompressQuery } = require('../services/context.service');
const { searchUserFiles } = require('../services/fileUpload.service');

// Approx chars per token (rough estimate for all models)
const CHARS_PER_TOKEN = 4;

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
    topicId,
    memoryMode = 'summarized',
    historyLimit = 10,
  } = req.body;

  // ── 0. Setup Abort Controller for request cancellation ──
  const abortController = new AbortController();
  req.on('close', () => {
    if (!res.writableEnded) {
      console.log('[Chat] User stopped the query. Aborting downstream tasks...');
      abortController.abort();
    }
  });

  const user = req.user;        // null for anonymous
  const isAnonymous = !user;

  try {
    // ── 1. Validate model ────────────────────────────────────
    const modelConfig = MODELS[modelId];
    const effectiveModelConfig = providerModelId
      ? { ...modelConfig, model: providerModelId }
      : modelConfig;
    if (!modelConfig) {
      return res.status(400).json({ error: `Unknown model: ${modelId}` });
    }

    // ── 2. Check per-query token limit ───────────────────────
    const estimatedInputTokens = Math.ceil(message.length / CHARS_PER_TOKEN);
    if (user && estimatedInputTokens > user.per_query_limit) {
      return res.status(400).json({
        error: `Query too long. Max ${user.per_query_limit} tokens per query. Your query is ~${estimatedInputTokens} tokens.`,
      });
    }

    // ── 3. Compress prompt (remove filler words) ─────────────
    const compressedQuery = compressPrompt(message);

    // ── 4. Check query cache ─────────────────────────────────
    const cachedReply = await getCachedResponse(compressedQuery, modelId);
    if (cachedReply) {
      // Save to analytics but mark as cache hit
      await logAnalytics({
        userId: user?.id, query: message, modelId, tokensUsed: 0,
        isAnonymous, cacheHit: true, responseTimeMs: Date.now() - startTime
      });

      return res.json({
        reply: cachedReply,
        tokensUsed: 0,
        cacheHit: true,
        model: modelConfig.label,
      });
    }

    // ── 5. Maybe compress long queries with Gemini Flash ─────
    const finalQuery = await maybeCompressQuery(compressedQuery, abortController.signal);

    // ── 5.5 Generate query embedding once to save tokens ──────
    const queryVector = await embedText(finalQuery, modelConfig.provider, 3, abortController.signal);

    // ── 6. Fetch RAG context ─────────────────────────────────
    const ragContext = await buildRAGContext(finalQuery, modelConfig.provider, abortController.signal, queryVector);

    // ── 7. Fetch uploaded file context ──────────────────────────
    const fileResults = await searchUserFiles(finalQuery, user?.id, topicId, modelConfig.provider, abortController.signal, queryVector);
    const fileContext = fileResults.length > 0
      ? `[FILE REFERENCES]\n${fileResults
        .map(r => `Source: ${r.file_name} (Relevance: ${Math.round(r.similarity * 100)}%)\n${r.chunk_text}`)
        .join('\n\n')}\n[END FILE REFS]\n`
      : '';

    // ── 8. Fetch conversation history context ────────────────
    const { context: historyContext } = await buildContextMessages(
      finalQuery,
      isAnonymous ? null : topicId,
      { memoryMode, historyLimit },
      abortController.signal
    );

    // ── 9. Build final AI message payload ───────────────────
    const aiMessages = [];

    // System prompt with RAG + file context
    const systemPrompt = `You are a helpful AI assistant. Be concise, accurate, and helpful.${ragContext ? `\n\n${ragContext}` : ''}${fileContext ? `\n\n${fileContext}` : ''}`;
    aiMessages.push({
      role: 'system',
      content: systemPrompt,
    });

    // History context (if same topic)
    aiMessages.push(...historyContext);

    // Current user message
    aiMessages.push({ role: 'user', content: finalQuery });

    // ── 9. Call AI ───────────────────────────────────────────
    const { text: reply, tokensUsed } = await dispatchToAI(effectiveModelConfig, aiMessages, abortController.signal);

    // Check if user aborted while AI was generating
    if (abortController.signal.aborted) return;

    // ── 10. Cache the response for future repeated queries ────
    await setCachedResponse(finalQuery, modelId, reply);

    // ── 12. Save messages to DB (logged-in users only) ────────
    let resolvedTopicId = topicId;
    if (!isAnonymous) {
      // Create new topic if none provided
      if (!resolvedTopicId) {
        const topicTitle = message.trim().slice(0, 60) + (message.length > 60 ? '...' : '');
        const { data: newTopic, error: topicError } = await supabase
          .from('topics')
          .insert({ user_id: user.id, title: topicTitle, model: modelId })
          .select('id')
          .single();

        if (topicError) {
          console.error('[Chat] Topic creation failed:', topicError.message);
        } else {
          resolvedTopicId = newTopic?.id;
        }
      }

      if (resolvedTopicId) {
        // Save user message + assistant reply
        await supabase.from('messages').insert([
          { topic_id: resolvedTopicId, user_id: user.id, role: 'user', content: message, model: modelId, tokens_used: estimatedInputTokens },
          { topic_id: resolvedTopicId, user_id: user.id, role: 'assistant', content: reply, model: modelId, tokens_used: tokensUsed },
        ]);

        // Update topic timestamp
        await supabase.from('topics')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', resolvedTopicId);
      }
    }

    // ── 11. Update user token usage (after successful persistence) ──
    if (user) {
      await supabase
        .from('users')
        .update({ used_tokens: user.used_tokens + tokensUsed })
        .eq('id', user.id);
    }

    // ── 13. Log to analytics ─────────────────────────────────
    await logAnalytics({
      userId: user?.id, query: message, modelId, tokensUsed,
      isAnonymous, cacheHit: false, responseTimeMs: Date.now() - startTime,
    });

    // ── 14. Return response ───────────────────────────────────
    res.json({
      reply,
      tokensUsed,
      topicId: resolvedTopicId,
      cacheHit: false,
      model: modelConfig.label,
      // Updated token stats for header display
      tokenStats: user ? {
        total: user.total_tokens,
        used: user.used_tokens + tokensUsed,
        remaining: user.total_tokens - user.used_tokens - tokensUsed,
      } : null,
    });

  } catch (err) {
    // Gracefully handle manual aborts
    if (err.name === 'AbortError' || abortController.signal.aborted) {
      return; 
    }

    console.error('[Chat] Error:', err.message);

    const messageText = err.message || '';
    let errorType = 'unknown';
    let userMessage = 'The selected LLM is temporarily unavailable.';

    if (/quota|insufficient|credit|billing|exceeded/i.test(messageText)) {
      errorType = 'quota_exhausted';
      userMessage = 'The selected LLM token quota is exhausted.';
    } else if (/rate limit|429|too many/i.test(messageText)) {
      errorType = 'rate_limited';
      userMessage = 'The selected LLM is rate limited right now.';
    } else if (/decommissioned|not found|unsupported|model/i.test(messageText)) {
      errorType = 'model_unavailable';
      userMessage = 'The selected LLM model is unavailable or no longer supported.';
    } else if (/api key|authentication|unauthorized|401/i.test(messageText)) {
      errorType = 'api_key_missing';
      userMessage = 'The selected LLM is not configured correctly.';
    }

    res.status(503).json({
      error: userMessage,
      errorType,
      retryable: true,
      failedModelId: modelId,
    });
  }
};

/**
 * Helper: log query to analytics table
 */
const logAnalytics = async ({ userId, query, modelId, tokensUsed, isAnonymous, cacheHit, responseTimeMs }) => {
  try {
    await supabase.from('query_analytics').insert({
      user_id: userId || null,
      query_text: query.slice(0, 500),
      model: modelId,
      tokens_used: tokensUsed,
      is_anonymous: isAnonymous,
      cache_hit: cacheHit,
      response_time_ms: responseTimeMs,
    });
  } catch (e) {
    // Analytics failure should never break chat
    console.error('[Analytics] Log failed:', e.message);
  }
};

module.exports = { sendMessage };
