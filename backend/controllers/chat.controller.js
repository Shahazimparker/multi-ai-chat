// ============================================================
// FILE: backend/controllers/chat.controller.js
// PURPOSE: Core chat logic — processes user messages through:
//   1. Prompt compression    (remove filler words)
//   2. Cache check           (return if repeated query)
//   3. RAG context injection (relevant knowledge docs)
//   4. Business DB query     (live data from ERP tables)
//   5. History context       (last 10 msgs if same topic)
//   6. AI dispatch           (call correct AI provider)
//   7. Token tracking        (update user quota)
//   8. Save to DB            (persist for logged-in users)
//   9. Analytics logging     (all queries tracked)
// ============================================================

const supabase = require('../config/supabase');
const { MODELS } = require('../config/models');
const { dispatchToAI } = require('../services/ai/dispatcher.service');
const { compressPrompt } = require('../services/compress.service');
const { getSemanticCachedResponse, setCachedResponse } = require('../services/cache.service');
const { buildRAGContext, embedText } = require('../services/rag.service');
const { buildContextMessages, maybeCompressQuery } = require('../services/context.service');
const { listUserFiles } = require('../services/fileUpload.service');
const { logAnalytics } = require('../services/analytics.service');
const {
  MAX_DB_QUERIES,
  MAX_CONSECUTIVE_ZERO_RESULTS,
  reserveToolLoopBudget,
  extractReferencedTables,
  ensureBizDbInit,
  buildBizDbDirective,
  buildFileContext,
  processToolCall,
  stripToolTags,
  buildFallbackDbReply,
  classifyError,
  bizDbConnected,
} = require('../services/chat.service');

const {
  createPromptBudget,
  createDynamicPromptBudget,
  calculateComplexityScore,
  getTopicTurnCount,
  estimateMessagesTokens,
  estimateTokens,
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
    dbOnly = false,
  } = req.body;

  // dbOnly mode: AI must query DB before answering
  const effectiveDbOnly = dbOnly;

  // Ensure business DB is initialized (shared singleton)
  await ensureBizDbInit();

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
  let resolvedTopicId = topicId;

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
    promptBudget = reserveToolLoopBudget(promptBudget);
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
    const compressResult = await maybeCompressQuery(compressedQuery, abortController.signal);
    const finalQuery = typeof compressResult === 'string' ? compressResult : compressResult.query;
    const compressTokens = typeof compressResult === 'string' ? 0 : (compressResult.tokensUsed || 0);

    // ── 5.5 Generate query embedding once to save tokens ──────
    let queryVector = null;
    let totalEmbeddingTokens = 0;  // ← tracks ALL embedding API token costs

    if (ragEnabled) {
      if (abortController.signal.aborted) throw { name: 'AbortError' };
      const embedResult = await embedText(finalQuery, modelConfig.provider, 3, abortController.signal, user?.id);
      if (embedResult) {
        queryVector = embedResult.vector;
        totalEmbeddingTokens += embedResult.tokensUsed;
      }

      // Skip semantic cache in dbOnly mode — business DB queries must always be fresh
      if (!dbOnly) {
        const semanticCachedReply = await getSemanticCachedResponse(queryVector, modelId, 0.92, user?.id, topicId);
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
    }

    // ── 6. Fetch RAG context ─────────────────────────────────
    let ragContext = '';
    let fileResults = [];
    let totalFileCount = 0;

    if (ragEnabled) {
      if (abortController.signal.aborted) throw { name: 'AbortError' };
      const [ragCtx, fileData] = await Promise.all([
        buildRAGContext(
          finalQuery,
          modelConfig.provider,
          abortController.signal,
          queryVector,
          {
            tokenBudget: promptBudget.ragTokens,
            topicId,
            userId: user?.id,
          }
        ),
        // HYBRID: Get ALL files for the topic (no limit, no similarity filter)
        listUserFiles(user?.id, topicId)
      ]);
      ragContext = ragCtx;
      fileResults = fileData.files || [];
      totalFileCount = fileData.totalCount || 0;
    }

    // ── HYBRID APPROACH: File names only, tools for content ──
    const fileContext = buildFileContext(fileResults, totalFileCount);


    // ── 8. Fetch conversation history context ────────────────
    const { context: historyContext, summaryTokens: historySummaryTokens } = await buildContextMessages(
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

    // System prompt — static (cacheable) + dynamic (per-request) separated for prompt caching
    const runtimeIdentity = `MODEL_IDENTITY: ${modelConfig.label} | provider=${effectiveModelConfig.provider} | model=${effectiveModelConfig.model}`;
    const identityDirective = isIdentityQuestion
      ? `\n\nIf the user asks what model/company you are, reply EXACTLY with:\n${runtimeIdentity}`
      : '';

    const { bizDbDirective } = buildBizDbDirective(effectiveDbOnly);

    const staticSystem = `You are a helpful AI assistant. Be concise, accurate, and helpful.\n${runtimeIdentity}${identityDirective}${bizDbDirective}\n\nRules:\n- Format ABAP, SQL, JSON, XML code in \`\`\` blocks with language label ONLY if the user explicitly asks for code/SQL.\n- Use tables for structured data (configuration, field mappings) when presenting DB results.\n- Use bullet points for better clarity.\n- When explaining errors, show the error first, then root cause, then fix.`;
    aiMessages.push({ role: 'system', content: staticSystem });
    // Dynamic parts — NOT cacheable (change per request)
    if (ragContext) {
      aiMessages.push({ role: 'system', content: `## Retrieved Context\n${ragContext}` });
    }
    if (fileContext) {
      aiMessages.push({ role: 'system', content: `## File Context\n${fileContext}` });
    }

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


    // Accumulate embedding tokens from all embedText calls
    // Note: estimatedInputTokens covers the raw user message
    let totalAITokens = 0;       // ← accumulates all dispatchToAI rounds
    const promptTokens = estimateMessagesTokens(aiMessages);
    if (user && promptTokens > user.per_query_limit) {
      return res.status(400).json({
        error: `Query context too large after RAG/history. Max ${user.per_query_limit} tokens per query. Current prompt is ~${promptTokens} tokens.`,
      });
    }

    // ── 9. Call AI (tool-call loop) ──────────────────────────
    let reply, tokensUsed;
    let finalReply = '';
    let dbQueried = false;
    let lastDbResultBlock = '';
    let consecutiveZeroResults = 0;
    let lastSqlQuery = '';
    let dbQueryCount = 0;
    const fetchedSchemaTables = new Set();

    // Tool-call loop: AI can search files, request full content, or query business DB
    const MAX_TOOL_ROUNDS = effectiveDbOnly ? 24 : 6;
    const TOOL_ROUND_START = aiMessages.length;
    const MAX_TOOL_TOKENS = Math.floor(promptBudget.maxPromptTokens * 0.5);

    const trimOldestToolRounds = () => {
      const estimatedToolTokens = estimateMessagesTokens(aiMessages.slice(TOOL_ROUND_START));
      if (estimatedToolTokens <= MAX_TOOL_TOKENS) return;

      while (aiMessages.length > TOOL_ROUND_START + 2) {
        const oldPairTokens = estimateTokens(aiMessages[TOOL_ROUND_START].content || '') +
          estimateTokens(aiMessages[TOOL_ROUND_START + 1].content || '') + 8;
        aiMessages.splice(TOOL_ROUND_START, 2);
        console.log(`[Tool] Trimmed oldest tool round (~${oldPairTokens} tokens) — ${aiMessages.length - TOOL_ROUND_START} tool messages remain`);
        if (estimateMessagesTokens(aiMessages.slice(TOOL_ROUND_START)) <= MAX_TOOL_TOKENS) break;
      }
    };

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      console.log(`[Tool] Round ${round}/${MAX_TOOL_ROUNDS}`);
      const result = await dispatchToAI(effectiveModelConfig, aiMessages, abortController.signal);
      reply = result.text;
      tokensUsed = result.tokensUsed;
      totalAITokens += tokensUsed || 0;
      console.log(`[Tool] Reply length: ${reply.length}, Has [QUERY_DB]: ${reply.includes('[QUERY_DB]')}, Has <QUERY_DB>: ${reply.includes('<QUERY_DB>')}`);
      if (abortController.signal.aborted) return;

      // Use shared tool processor
      const toolResult = await processToolCall({
        reply,
        aiMessages,
        user,
        topicId,
        effectiveDbOnly,
        abortController,
        fetchedSchemaTables,
        consecutiveZeroResults,
        dbQueryCount,
      });

      if (toolResult.handled) {
        // Apply new messages from tool processor
        aiMessages.push(...toolResult.newMessages);
        totalEmbeddingTokens += toolResult.embedTokens || 0;
        if (toolResult.dbQueried) dbQueried = true;
        if (toolResult.lastSqlQuery) lastSqlQuery = toolResult.lastSqlQuery;
        if (toolResult.lastDbResultBlock) lastDbResultBlock = toolResult.lastDbResultBlock;
        consecutiveZeroResults = toolResult.consecutiveZeroResults || 0;
        if (toolResult.dbQueryCount !== undefined) dbQueryCount = toolResult.dbQueryCount;
        trimOldestToolRounds();

        // Break on 4+ consecutive zero results
        if (consecutiveZeroResults >= MAX_CONSECUTIVE_ZERO_RESULTS) {
          finalReply = reply.replace(/\[QUERY_DB\][\s\S]*?(?:\[\/QUERY_DB\]|<\/SQL_QUERY>|<\/QUERY_DB>)/g, '').trim() || 'No data found.';
          console.log(`[Tool] ${MAX_CONSECUTIVE_ZERO_RESULTS} consecutive zero results — breaking tool loop`);
          break;
        }

        // Break on max DB queries
        if (dbQueryCount >= MAX_DB_QUERIES) {
          if (!finalReply) finalReply = 'Maximum database queries reached.';
          console.log(`[Tool] Max DB queries (${dbQueryCount}) reached — breaking tool loop`);
          break;
        }
        continue;
      }

      // Controller-specific: DISTINCT-only placeholder detection (not in stream handler)
      if (dbOnly && dbQueried && lastSqlQuery) {
        const isDistinctOnly = /SELECT\s+DISTINCT\s+/i.test(lastSqlQuery) &&
          !/\b(COUNT|SUM|AVG|MIN|MAX|GROUP\s+BY)\b/i.test(lastSqlQuery);
        const replyHasPlaceholder = /[\t\n]-\s*[\t\n]/.test(reply) || /would\s+(you\s+)?(like|prefer)/i.test(reply);
        const userAsksForMetrics = /count|how\s+many|total|number\s+of|status|list|all/i.test(finalQuery);

        if (isDistinctOnly && replyHasPlaceholder && userAsksForMetrics) {
          aiMessages.push({ role: 'assistant', content: reply });
          aiMessages.push({ role: 'user', content: '[SYSTEM] You queried DISTINCT values but the user asked for counts/metrics. Run a new query with COUNT(*) and GROUP BY to get actual numbers — no placeholders, no deferring.' });
          trimOldestToolRounds();
          continue;
        }
      }

      // No tool call — done
      finalReply = reply;
      break;
    }

    if (!finalReply) {
      finalReply = reply || '';
    }

    // Strip leftover tool-call tags
    finalReply = stripToolTags(finalReply);

    // Fallback: if AI exhausted rounds but DID query DB, show raw DB results
    if (dbQueried && lastDbResultBlock && consecutiveZeroResults < 4 && (!finalReply || finalReply.length < 20)) {
      finalReply = buildFallbackDbReply(lastDbResultBlock);
    }

    // Prefer API-reported tokens (accurate). Fall back to estimate only if totalAITokens is 0.
    const billableTokens = (totalAITokens > 0)
      ? totalAITokens + totalEmbeddingTokens + estimatedInputTokens + compressTokens + (historySummaryTokens || 0)
      : promptTokens + estimateTokens(finalReply) + totalEmbeddingTokens + estimatedInputTokens + compressTokens + (historySummaryTokens || 0);

    // Check if user aborted while AI was generating
    if (abortController.signal.aborted) return;

    // ── 10. Cache the response for future repeated queries ────
    if (!isIdentityQuestion) {
      await setCachedResponse(finalQuery, modelId, finalReply, queryVector, user?.id, resolvedTopicId);
    }

    // ── 12. Save messages to DB (logged-in users only) ────────
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
          { topic_id: resolvedTopicId, user_id: user.id, role: 'assistant', content: finalReply, model: modelId, tokens_used: billableTokens },
        ]);

        // Update topic timestamp
        await supabase.from('topics')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', resolvedTopicId);
      }
    }

    // ── 11. Update user token usage (after successful persistence) ──
    if (user) {
      console.log(`[TokenTracking] AI=${totalAITokens} Embedding=${totalEmbeddingTokens} InputMsg=${estimatedInputTokens} Total=${billableTokens}`);
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

    // Safety net: strip tool call syntax from final reply in dbOnly mode
    if (bizDbConnected() && effectiveDbOnly && finalReply) {
      finalReply = stripToolTags(finalReply, { stripSqlBlocks: true });
    }

    // ── 14. Return response ───────────────────────────────────
    res.json({
      reply: finalReply,
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

    const { errorType, userMessage } = classifyError(err.message);

    res.status(503).json({
      error: userMessage,
      errorType,
      retryable: true,
      failedModelId: modelId,
    });
  }
};

module.exports = { sendMessage };
