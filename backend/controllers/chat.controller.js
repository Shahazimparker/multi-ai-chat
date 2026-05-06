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

const supabase                          = require('../config/supabase');
const { MODELS }                        = require('../config/models');
const { dispatchToAI }                  = require('../services/ai/dispatcher.service');
const { compressPrompt }                = require('../services/compress.service');
const { getCachedResponse, setCachedResponse } = require('../services/cache.service');
const { buildRAGContext }               = require('../services/rag.service');
const { buildContextMessages, maybeCompressQuery } = require('../services/context.service');

// Approx chars per token (rough estimate for all models)
const CHARS_PER_TOKEN = 4;

/**
 * POST /api/chat/message
 * Body: { modelId, message, topicId? }
 * Auth: Optional (anonymous users allowed but no history saved)
 */
const sendMessage = async (req, res) => {
  const startTime   = Date.now();
  const { modelId, message, topicId } = req.body;
  const user        = req.user;        // null for anonymous
  const isAnonymous = !user;

  try {
    // ── 1. Validate model ────────────────────────────────────
    const modelConfig = MODELS[modelId];
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
      await logAnalytics({ userId: user?.id, query: message, modelId, tokensUsed: 0,
        isAnonymous, cacheHit: true, responseTimeMs: Date.now() - startTime });

      return res.json({
        reply:      cachedReply,
        tokensUsed: 0,
        cacheHit:   true,
        model:      modelConfig.label,
      });
    }

    // ── 5. Maybe compress long queries with Gemini Flash ─────
    const finalQuery = await maybeCompressQuery(compressedQuery);

    // ── 6. Fetch RAG context ─────────────────────────────────
    const ragContext = await buildRAGContext(finalQuery);

    // ── 7. Fetch conversation history context ────────────────
    const { context: historyContext } = await buildContextMessages(
      finalQuery,
      isAnonymous ? null : topicId
    );

    // ── 8. Build final messages array ────────────────────────
    const messages = [];

    // System prompt
    messages.push({
      role:    'user',
      content: `You are a helpful AI assistant. Be concise, accurate, and helpful.${
        ragContext ? `\n\n${ragContext}` : ''
      }`,
    });

    // History context (if same topic)
    messages.push(...historyContext);

    // Current user message
    messages.push({ role: 'user', content: finalQuery });

    // ── 9. Call AI ───────────────────────────────────────────
    const { text: reply, tokensUsed } = await dispatchToAI(modelConfig, messages);

    // ── 10. Cache the response for future repeated queries ────
    await setCachedResponse(finalQuery, modelId, reply);

    // ── 11. Update user token usage ──────────────────────────
    if (user) {
      await supabase
        .from('users')
        .update({ used_tokens: user.used_tokens + tokensUsed })
        .eq('id', user.id);
    }

    // ── 12. Save messages to DB (logged-in users only) ────────
    let resolvedTopicId = topicId;
    if (!isAnonymous) {
      // Create new topic if none provided
      if (!resolvedTopicId) {
        const topicTitle = message.slice(0, 60) + (message.length > 60 ? '...' : '');
        const { data: newTopic } = await supabase
          .from('topics')
          .insert({ user_id: user.id, title: topicTitle, model: modelId })
          .select('id')
          .single();
        resolvedTopicId = newTopic?.id;
      }

      if (resolvedTopicId) {
        // Save user message + assistant reply
        await supabase.from('messages').insert([
          { topic_id: resolvedTopicId, user_id: user.id, role: 'user',      content: message,  model: modelId, tokens_used: estimatedInputTokens },
          { topic_id: resolvedTopicId, user_id: user.id, role: 'assistant', content: reply,    model: modelId, tokens_used: tokensUsed },
        ]);

        // Update topic timestamp
        await supabase.from('topics')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', resolvedTopicId);
      }
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
      topicId:   resolvedTopicId,
      cacheHit:  false,
      model:     modelConfig.label,
      // Updated token stats for header display
      tokenStats: user ? {
        total:     user.total_tokens,
        used:      user.used_tokens + tokensUsed,
        remaining: user.total_tokens - user.used_tokens - tokensUsed,
      } : null,
    });

  } catch (err) {
    console.error('[Chat] Error:', err.message);
    res.status(500).json({ error: err.message || 'Chat processing failed' });
  }
};

/**
 * Helper: log query to analytics table
 */
const logAnalytics = async ({ userId, query, modelId, tokensUsed, isAnonymous, cacheHit, responseTimeMs }) => {
  try {
    await supabase.from('query_analytics').insert({
      user_id:         userId || null,
      query_text:      query.slice(0, 500),
      model:           modelId,
      tokens_used:     tokensUsed,
      is_anonymous:    isAnonymous,
      cache_hit:       cacheHit,
      response_time_ms: responseTimeMs,
    });
  } catch (e) {
    // Analytics failure should never break chat
    console.error('[Analytics] Log failed:', e.message);
  }
};

module.exports = { sendMessage };
