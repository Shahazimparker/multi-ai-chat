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
const { getCachedResponse, getSemanticCachedResponse, setCachedResponse } = require('../services/cache.service');
const { buildRAGContext, embedText } = require('../services/rag.service');
const { buildContextMessages, maybeCompressQuery } = require('../services/context.service');
const { searchUserFilesRAG } = require('../services/fileUpload.service');
const { logAnalytics } = require('../services/analytics.service');

const {
  createPromptBudget,
  createDynamicPromptBudget,
  calculateComplexityScore,
  getTopicTurnCount,
  estimateMessagesTokens,
  estimateTokens,
  fitMessagesToBudget,
  trimTextByTokens,
} = require('../services/tokenBudget.service');


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
  } = req.body;

  // ── 0. Setup Abort Controller for request cancellation ──
  const abortController = new AbortController();
  const abortDownstreamTasks = () => {
    if (!abortController.signal.aborted && !res.writableEnded) {
      console.log('[Chat] User stopped the query. Aborting downstream tasks...');
      abortController.abort();
    }
  };
  req.on('aborted', abortDownstreamTasks);
  res.on('close', abortDownstreamTasks);

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
    let promptBudget = createPromptBudget(modelConfig);
    // Try dynamic budget if we have a topic
    if (topicId && user) {
      try {
        const turnCount = await getTopicTurnCount(topicId);
        const complexityScore = calculateComplexityScore(message);
        promptBudget = createDynamicPromptBudget(turnCount, complexityScore, modelConfig);
      } catch (err) {
        console.warn('[Chat] Dynamic budget failed, using static:', err.message);
      }
    }

    if (user?.per_query_limit && user.per_query_limit < promptBudget.maxPromptTokens) {
      const scale = Math.max(0.35, user.per_query_limit / promptBudget.maxPromptTokens);
      promptBudget = {
        ...promptBudget,
        maxPromptTokens: user.per_query_limit,
        systemTokens: Math.floor(promptBudget.systemTokens * scale),
        historyTokens: Math.floor(promptBudget.historyTokens * scale),
        ragTokens: Math.floor(promptBudget.ragTokens * scale),
        fileTokens: Math.floor(promptBudget.fileTokens * scale),
        queryTokens: Math.floor(promptBudget.queryTokens * scale),
      };
    }
    const estimatedInputTokens = estimateTokens(message);
    if (user && estimatedInputTokens > user.per_query_limit) {
      return res.status(400).json({
        error: `Query too long. Max ${user.per_query_limit} tokens per query. Your query is ~${estimatedInputTokens} tokens.`,
      });
    }

    // ── 3. Compress prompt (remove filler words) ─────────────
    const compressedQuery = compressPrompt(message);

    const isIdentityQuestion = /(^|\b)(what(\s+is)?\s+your\s+(llm\s+)?model|what\s+model\s+are\s+you|what\s+is\s+the\s+(llm\s+)?model\s+name|model\s+name|llm\s+name|which\s+company(\s+llm)?\s+you\s+are|which\s+company(\s+llm)?\s+are\s+you|who\s+are\s+you|what\s+are\s+you)(\b|$)/i.test(compressedQuery);

    // ── 4. Check query cache ─────────────────────────────────
    /***
    if (!isIdentityQuestion) {
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
    }

    */
    // ── 5. Maybe compress long queries with Gemini Flash ─────
    if (abortController.signal.aborted) throw { name: 'AbortError' };
    const finalQuery = await maybeCompressQuery(compressedQuery, abortController.signal);

    // ── 5.5 Generate query embedding once to save tokens ──────
    let queryVector = null;

    if (ragEnabled) {
      if (abortController.signal.aborted) throw { name: 'AbortError' };
      queryVector = await embedText(finalQuery, modelConfig.provider, 3, abortController.signal);

      const semanticCachedReply = await getSemanticCachedResponse(queryVector, modelId);
      if (semanticCachedReply) {
        await logAnalytics({
          userId: user?.id,
          query: message,
          modelId,
          tokensUsed: 0,
          isAnonymous,
          cacheHit: true,
          responseTimeMs: Date.now() - startTime,
        });

        return res.json({
          reply: semanticCachedReply,
          tokensUsed: 0,
          topicId: topicId || null,
          cacheHit: true,
          model: effectiveModelConfig.label,
          tokenStats: user ? {
            total: user.total_tokens,
            used: user.used_tokens,
            remaining: user.total_tokens - user.used_tokens,
          } : null,
        });
      }
    }

    // ── 6. Fetch RAG context ─────────────────────────────────
    let ragContext = '';
    let fileResults = [];

    if (ragEnabled) {
      if (abortController.signal.aborted) throw { name: 'AbortError' };
      [ragContext, fileResults] = await Promise.all([
        buildRAGContext(
          finalQuery,
          modelConfig.provider,
          abortController.signal,
          queryVector,
          { tokenBudget: promptBudget.ragTokens }
        ),
        searchUserFilesRAG(
          finalQuery,
          user?.id,
          topicId,
          abortController.signal
        )
      ]);
    }

    const fileContext = fileResults.length > 0
      ? trimTextByTokens(
        `[UPLOADED FILE ANALYSES]\n${fileResults
          .map(r => `File: ${r.file_name}\n${r.chunk_text}`)
          .join('\n\n---\n')}\n[END ANALYSES]\n`,
        promptBudget.fileTokens
      )
      : '';


    // ── 8. Fetch conversation history context ────────────────
    const { context: historyContext } = await buildContextMessages(
      finalQuery,
      isAnonymous ? null : topicId,
      {
        memoryMode,
        historyLimit,
        tokenBudget: promptBudget.historyTokens,
        userId: user?.id,
      },
      abortController.signal
    );

    // ── 9. Build final AI message payload ───────────────────
    const aiMessages = [];

    // System prompt with RAG + file context
    const runtimeIdentity = `MODEL_IDENTITY: ${modelConfig.label} | provider=${effectiveModelConfig.provider} | model=${effectiveModelConfig.model}`;
    const identityDirective = isIdentityQuestion
      ? `\n\nIf the user asks what model/company you are, reply EXACTLY with:\n${runtimeIdentity}`
      : '';
    const systemPrompt = `You are a helpful AI assistant. Be concise, accurate, and helpful.\n${runtimeIdentity}${identityDirective}${ragContext ? `\n\n${ragContext}` : ''}${fileContext ? `\n\n${fileContext}` : ''}`;
    aiMessages.push({
      role: 'system',
      content: systemPrompt,
    });

    // History context (if same topic)
    if (historyContext && historyContext.length > 0) {
      aiMessages.push(...historyContext);
    }

    // Current user message
    const userContent = image
      ? [
        { type: 'text', text: finalQuery || 'Analyze this image' },
        { type: 'image_url', image_url: { url: image } }
      ]
      : trimTextByTokens(finalQuery, promptBudget.queryTokens);
    aiMessages.push({ role: 'user', content: userContent });


    const promptTokens = estimateMessagesTokens(aiMessages);
    if (user && promptTokens > user.per_query_limit) {
      return res.status(400).json({
        error: `Query context too large after RAG/history. Max ${user.per_query_limit} tokens per query. Current prompt is ~${promptTokens} tokens.`,
      });
    }

    // ── 9. Call AI ───────────────────────────────────────────
    const { text: reply, tokensUsed, cacheCreationTokens = 0, cacheReadTokens = 0 } = await dispatchToAI(effectiveModelConfig, aiMessages, abortController.signal);
    const billableTokens = Math.max(tokensUsed || 0, promptTokens + estimateTokens(reply));

    // Check if user aborted while AI was generating
    if (abortController.signal.aborted) return;

    // ── 10. Cache the response for future repeated queries ────
    if (!isIdentityQuestion) {
      await setCachedResponse(finalQuery, modelId, reply, queryVector);
    }

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
          { topic_id: resolvedTopicId, user_id: user.id, role: 'assistant', content: reply, model: modelId, tokens_used: billableTokens },
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
        .update({ used_tokens: user.used_tokens + billableTokens })
        .eq('id', user.id);
    }

    // ── 13. Log to analytics ─────────────────────────────────
    await logAnalytics({
      userId: user?.id, query: message, modelId, tokensUsed: billableTokens,
      isAnonymous, cacheHit: false, responseTimeMs: Date.now() - startTime,
    });

    // ── 14. Return response ───────────────────────────────────
    res.json({
      reply,
      tokensUsed: billableTokens,
      topicId: resolvedTopicId,
      cacheHit: false,
      model: modelConfig.label,
      // Updated token stats for header display
      tokenStats: user ? {
        total: user.total_tokens,
        used: user.used_tokens + billableTokens,
        remaining: user.total_tokens - user.used_tokens - billableTokens,
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

module.exports = { sendMessage };
