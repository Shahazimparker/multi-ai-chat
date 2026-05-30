// ============================================================
// FILE: backend/services/chatPipeline.service.js
// PURPOSE: Shared pipeline for streaming chat and legacy JSON compatibility.
// ============================================================
// Both routes follow the same flow:
//   1. Validate model
//   2. Compress query
//   3. Cache check (optional, per-route)
//   4. Embedding + semantic cache + RAG context + file listing
//   5. History context
//   6. Build system prompt + AI messages
//   7. Tool-call loop (with optional streaming)
//   8. Strip tool tags
//   9. Token calculation
//  10. Persist to DB (topic + messages)
//  11. Post-save memory embedding (optional)
//  12. Update user token usage
//  13. Analytics logging
// ============================================================

const supabase = require('../config/supabase');
const { MODELS } = require('../config/models');
const { CHAT_SEMANTIC_CACHE_THRESHOLD } = require('../config/chatRuntime.config');
const { compressPrompt } = require('./compress.service');
const { getCachedResponse, getSemanticCachedResponse, setCachedResponse } = require('./cache.service');
const { buildRAGContext, embedText } = require('./rag.service');
const { buildContextMessages, maybeCompressQuery } = require('./context.service');
const { embedAndStoreMessage, searchMemory } = require('./memory.service');
const { runOrchestratorBrain } = require('./orchestratorBrain.service');
const { listUserFiles } = require('./fileUpload.service');
const { logAnalytics } = require('./analytics.service');
const { calculateBillableTokens } = require('./tokenAccounting.service');
const { buildFileContext } = require('./toolProcessor.service');
const { runToolLoop } = require('./toolLoop.service');
const { stripToolTags, classifyError } = require('./chatCleanup.service');
const {
  createPromptBudget,
  createDynamicPromptBudget,
  calculateComplexityScore,
  getTopicTurnCount,
  estimateMessagesTokens,
  estimateTokens,
  trimTextByTokens,
} = require('./tokenBudget.service');

/**
 * runChatPipeline — single shared pipeline for streaming chat and legacy JSON compatibility.
 *
 * @param {Object} opts
 * @param {string}   opts.modelId
 * @param {string}   opts.message
 * @param {string}   [opts.image]
 * @param {string}   [opts.topicId]
 * @param {string}   [opts.providerModelId]
 * @param {object}   [opts.user]               — req.user (null for anonymous)
 * @param {boolean}  opts.isAnonymous
 * @param {string}   [opts.memoryMode='summarized']
 * @param {number}   [opts.historyLimit=5]
 * @param {boolean}  [opts.ragEnabled=false]
 * @param {Array}    [opts.history]             — client-provided history for anonymous
 * @param {AbortController} opts.abortController
 *
 * // ---- runtime controls ----
 * @param {boolean}  [opts.exactCacheEnabled=false]
 * @param {string}   [opts.embeddingProvider]
 * @param {boolean}  [opts.memoryEnabled=false]
 * @param {boolean}  [opts.identityCheckEnabled=false]
 * @param {boolean}  [opts.perQueryLimitEnabled=false]
 * @param {boolean}  [opts.dynamicBudgetEnabled=false]
 * @param {number}   [opts.historyTokenBudget]       — token budget for history context
 * @param {boolean}  [opts.cacheResponse=false]      — whether to call setCachedResponse
 * @param {boolean}  [opts.postSaveEmbedding=false]  — embed messages after save
 *
 * // ---- callbacks ----
 * @param {(chunk: string) => void} [opts.onStreamChunk]
 * @param {(event: object) => void} [opts.onToolStatus]
 *
 * @returns {Promise<{
 *   finalReply: string,
 *   billableTokens: number,
 *   totalAITokens: number,
 *   totalEmbeddingTokens: number,
 *   orchestratorBrain: object|null,
 *   cacheCreationTokens: number,
 *   cacheReadTokens: number,
 *   cacheHit: boolean,
 *   generatedMediaFiles: Array,
 *   resolvedTopicId: string|null,
 *   persistError: Error|null,
 *   estimatedInputTokens: number,
 *   compressTokens: number,
 *   historySummaryTokens: number,
 *   modelConfig: object,
 *   effectiveModelConfig: object,
 *   isIdentityQuestion: boolean,
 *   savedUserMessageId: string|null,
 *   savedAssistantMessageId: string|null,
 *   promptTokens: number,
 *   err: Error|null,           // non-null if the pipeline caught an error
 *   errorType: string|null,
 *   userMessage: string|null,
 * }>}
 */
const CANONICAL_CHAT_PIPELINE_FLAGS = Object.freeze({
  exactCacheEnabled: false,
  identityCheckEnabled: true,
  perQueryLimitEnabled: true,
  dynamicBudgetEnabled: true,
  memoryEnabled: true,
  cacheResponse: true,
  postSaveEmbedding: true,
  enableOrchestratorBrain: false,
});
const EXECUTE_CODE_ENABLED = String(process.env.ENABLE_EXECUTE_CODE || '').toLowerCase() === 'true';

const makePipelineResult = (overrides = {}) => ({
  finalReply: '',
  billableTokens: 0,
  totalAITokens: 0,
  totalEmbeddingTokens: 0,
  orchestratorBrain: null,
  queryCacheHit: false,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  cacheHit: false,
  generatedMediaFiles: [],
  resolvedTopicId: null,
  persistError: null,
  estimatedInputTokens: 0,
  compressTokens: 0,
  historySummaryTokens: 0,
  modelConfig: null,
  effectiveModelConfig: null,
  isIdentityQuestion: false,
  savedUserMessageId: null,
  savedAssistantMessageId: null,
  promptTokens: 0,
  err: null,
  errorType: null,
  userMessage: null,
  ...overrides,
});

const runChatPipeline = async (opts) => {
  const startTime = Date.now();

  // ── destructure with defaults ──────────────────────────────
  const {
    modelId = 'claude-sonnet',
    message,
    image,
    topicId,
    providerModelId,
    user,
    isAnonymous,
    memoryMode = 'summarized',
    historyLimit = 5,
    ragEnabled = false,
    history,
    abortController,

    // runtime flags
    exactCacheEnabled = false,
    embeddingProvider: embeddingProviderOpt,
    memoryEnabled = false,
    identityCheckEnabled = false,
    perQueryLimitEnabled = false,
    dynamicBudgetEnabled = false,
    historyTokenBudget,
    cacheResponse = false,
    postSaveEmbedding = false,
    enableOrchestratorBrain = false,

    // callbacks
    onStreamChunk,
    onToolStatus,
  } = opts;

  let resolvedTopicId = topicId;

  try {
    // ── 1. Validate model ──────────────────────────────────────
    const modelConfig = MODELS[modelId];
    const effectiveModelConfig = providerModelId
      ? { ...modelConfig, model: providerModelId }
      : modelConfig;
    if (!modelConfig) {
      return makePipelineResult({
        err: new Error(`Unknown model: ${modelId}`),
        errorType: 'invalid_model',
        userMessage: `Unknown model: ${modelId}`,
      });
    }

    const estimatedInputTokens = estimateTokens(message);
    const orchestratorBrain = (enableOrchestratorBrain && onStreamChunk)
      ? await runOrchestratorBrain({
          modelId,
          providerModelId,
          message,
          image,
          topicId,
          userId: user?.id || null,
          isAnonymous,
          memoryMode,
          historyLimit,
          ragEnabled,
        }, {
          effectiveModelConfig,
          abortController,
          onToolStatus,
        })
      : null;

    // ── 2. Prompt budget ──────────────────────────────────────
    let promptBudget = createPromptBudget(modelConfig);
    if (dynamicBudgetEnabled && topicId && user) {
      try {
        const turnCount = await getTopicTurnCount(topicId);
        const complexityScore = calculateComplexityScore(message);
        promptBudget = createDynamicPromptBudget(turnCount, complexityScore, modelConfig);
      } catch (err) {
        console.warn('[ChatPipeline] Dynamic budget failed, using static:', err.message);
      }
    }

    if (perQueryLimitEnabled && user?.per_query_limit && user.per_query_limit < promptBudget.maxPromptTokens) {
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

    if (perQueryLimitEnabled && user && estimatedInputTokens > user.per_query_limit) {
      return makePipelineResult({
        err: new Error(`Query too long. Max ${user.per_query_limit} tokens per query. Your query is ~${estimatedInputTokens} tokens.`),
        errorType: 'query_too_long',
        userMessage: `Query too long. Max ${user.per_query_limit} tokens per query. Your query is ~${estimatedInputTokens} tokens.`,
        estimatedInputTokens,
        modelConfig,
        effectiveModelConfig,
        resolvedTopicId,
      });
    }

    // ── 3. Compress prompt ────────────────────────────────────
    const compressedQuery = compressPrompt(message);
    const isIdentityQuestion = identityCheckEnabled
      ? /(^|\b)(what(\s+is)?\s+your\s+(llm\s+)?model|what\s+model\s+are\s+you|what\s+is\s+the\s+(llm\s+)?model\s+name|model\s+name|llm\s+name|which\s+company(\s+llm)?\s+you\s+are|which\s+company(\s+llm)?\s+are\s+you|who\s+are\s+you|what\s+are\s+you)(\b|$)/i.test(compressedQuery)
      : false;

    // ── 4. Exact-match cache ───────────────────────────────────
    if (exactCacheEnabled && !isIdentityQuestion) {
      const cachedReply = await getCachedResponse(compressedQuery, modelId, user?.id, topicId);
      if (cachedReply) {
        return makePipelineResult({
          finalReply: cachedReply,
          billableTokens: 0,
          cacheHit: true,
          modelConfig,
          effectiveModelConfig,
          isIdentityQuestion,
          resolvedTopicId,
          estimatedInputTokens,
          orchestratorBrain,
          queryCacheHit: true,
        });
      }
    }

    // ── 5. Maybe compress long queries with Gemini ────────────
    if (abortController.signal.aborted) throw { name: 'AbortError' };
    const compressResult = await maybeCompressQuery(compressedQuery, abortController.signal);
    const finalQuery = typeof compressResult === 'string' ? compressResult : compressResult.query;
    const compressTokens = typeof compressResult === 'string' ? 0 : (compressResult.tokensUsed || 0);

    // ── 5.5 Generate query embedding once ─────────────────────
    // Use explicit embedding provider, or default to 'openrouter' for cheap embeddings
    const embedProvider = embeddingProviderOpt || 'openrouter';
    let queryVector = null;
    let totalEmbeddingTokens = 0;

    if (ragEnabled) {
      if (abortController.signal.aborted) throw { name: 'AbortError' };
      const embedResult = await embedText(finalQuery, embedProvider, 3, abortController.signal, user?.id);
      if (embedResult) {
        queryVector = embedResult.vector;
        totalEmbeddingTokens += embedResult.tokensUsed;
      }

      // Semantic cache lookup (same embedding vector)
      {
        const semanticCachedReply = await getSemanticCachedResponse(queryVector, modelId, CHAT_SEMANTIC_CACHE_THRESHOLD, user?.id, topicId);
        if (semanticCachedReply) {
          return makePipelineResult({
            finalReply: semanticCachedReply,
            billableTokens: 0,
            cacheHit: true,
            modelConfig,
            effectiveModelConfig,
            isIdentityQuestion,
            resolvedTopicId,
            estimatedInputTokens,
            compressTokens,
            totalEmbeddingTokens,
            orchestratorBrain,
            queryCacheHit: true,
          });
        }
      }
    }

    // ── 6. RAG context + file listing ─────────────────────────
    let ragContext = '';
    let fileResults = [];
    let totalFileCount = 0;

    if (ragEnabled) {
      if (abortController.signal.aborted) throw { name: 'AbortError' };
      const [ragCtx, fileData] = await Promise.all([
        buildRAGContext(
          finalQuery,
          embedProvider,
          abortController.signal,
          queryVector,
          { tokenBudget: promptBudget.ragTokens, topicId, userId: user?.id }
        ),
        listUserFiles(user?.id, topicId),
      ]);
      ragContext = ragCtx;
      const normalizedFileData = Array.isArray(fileData)
        ? { files: fileData, totalCount: fileData.length }
        : (fileData || {});
      fileResults = normalizedFileData.files || [];
      totalFileCount = normalizedFileData.totalCount || fileResults.length;
    }

    const fileContext = buildFileContext(fileResults, totalFileCount);

    // ── 7. History context ────────────────────────────────────
    const historyOpts = {
      memoryMode,
      historyLimit,
      userId: user?.id,
    };
    if (historyTokenBudget !== undefined) {
      historyOpts.tokenBudget = historyTokenBudget;
    }
    const { context: historyContext, summaryTokens: historySummaryTokens, _debug } = await buildContextMessages(
      finalQuery,
      isAnonymous ? null : topicId,
      historyOpts,
      abortController.signal
    );

    if (_debug) {
      console.log(`[Dynamic Budget] Complexity: ${_debug.complexity.toFixed(2)}, Turns: ${_debug.turnCount}, Allocated: ${_debug.allocatedBudget} tokens`);
    }

    // ── 7.5 Cross-chat memory (accurate mode, message only) ───
    let memoryContext = '';
    if (memoryEnabled && ragEnabled && memoryMode === 'accurate' && queryVector && user?.id) {
      memoryContext = await searchMemory(queryVector, user.id, {
        excludeTopicId: resolvedTopicId,
        topK: 5,
        threshold: 0.5,
      });
    }

    // ── 8. Build AI messages ──────────────────────────────────
    const aiMessages = [];
    const allowExecuteCode = EXECUTE_CODE_ENABLED && Boolean(user?.id);
    const toolLines = [
      '1. Web Search: [WEB_SEARCH:query="your search query"]',
      ...(allowExecuteCode ? ['2. Execute JS Code: [EXECUTE_CODE]console.log("hello");[/EXECUTE_CODE]'] : []),
      `${allowExecuteCode ? '3' : '2'}. Generate Image (DALL-E 3): [GENERATE_IMAGE:prompt=detailed image description here]`,
      '   - Use when the user asks you to generate, create, or draw an image/picture/photo',
      '   - Write the most descriptive prompt possible for best results',
      `${allowExecuteCode ? '4' : '3'}. Generate PowerPoint: [GENERATE_PPT]{"title":"Presentation Title","subtitle":"Optional subtitle","theme":"modern_corporate","slides":[{"title":"Slide Title","layout":"cards","bullets":["Point 1","Point 2","Point 3"]},{"title":"Slide 2","layout":"two_column","bullets":["Left insight"],"content":"Right-side narrative"},{"title":"Slide 3","layout":"quote","content":"Key quote or thesis","subtitle":"Optional attribution"}]}[/GENERATE_PPT]`,
      '   - Use when the user asks you to create a presentation, slides, or PowerPoint',
      '   - Include 4-8 content slides with varied layouts for visual quality',
      '   - Allowed themes: modern_corporate, startup_bold, clean_minimal',
      '   - Allowed slide layouts: title_bullets, two_column, cards, quote, data_story',
      '   - Every slide needs a "title" plus either "bullets" (array) or "content" (string)',
      'Wait for the tool result before continuing your response.',
    ];
    const generalToolsDirective = `\n\n## General Tools\nYou have access to the following tools. Output EXACTLY the tags shown — no extra text inside the tags:\n${toolLines.join('\n')}`;

    const runtimeIdentity = `MODEL_IDENTITY: ${modelConfig.label} | provider=${effectiveModelConfig.provider} | model=${effectiveModelConfig.model}`;
    const identityDirective = identityCheckEnabled && isIdentityQuestion
      ? `\n\nIf the user asks what model/company you are, reply EXACTLY with:\n${runtimeIdentity}`
      : '';

    const staticSystem = `You are a helpful AI assistant. Be concise, accurate, and helpful.\n${runtimeIdentity}${identityDirective}${generalToolsDirective}`;
    const systemSections = [staticSystem];
    if (ragContext) systemSections.push(`## Retrieved Context\n${ragContext}`);
    if (fileContext) systemSections.push(`## File Context\n${fileContext}`);
    if (memoryContext) systemSections.push(memoryContext);
    aiMessages.push({ role: 'system', content: systemSections.join('\n\n') });

    // History
    if (historyContext && historyContext.length > 0) {
      aiMessages.push(...historyContext);
    } else if (history && Array.isArray(history) && history.length > 0) {
      aiMessages.push(...history);
    }

    // Current user message
    const userContent = image
      ? [
          { type: 'text', text: finalQuery || 'Analyze this image' },
          { type: 'image_url', image_url: { url: image } },
        ]
      : trimTextByTokens(finalQuery, promptBudget.queryTokens);
    aiMessages.push({ role: 'user', content: userContent });

    const promptTokens = estimateMessagesTokens(aiMessages);

    if (perQueryLimitEnabled && user && promptTokens > user.per_query_limit) {
      return makePipelineResult({
        err: new Error(`Query context too large after RAG/history. Max ${user.per_query_limit} tokens per query. Current prompt is ~${promptTokens} tokens.`),
        errorType: 'context_too_large',
        userMessage: `Query context too large after RAG/history. Max ${user.per_query_limit} tokens per query. Current prompt is ~${promptTokens} tokens.`,
        promptTokens,
        estimatedInputTokens,
        compressTokens,
        historySummaryTokens,
        modelConfig,
        effectiveModelConfig,
        isIdentityQuestion,
        orchestratorBrain,
        resolvedTopicId,
      });
    }

    // ── 9. Tool-call loop ─────────────────────────────────────
    let totalAITokens = 0;
    let finalReply = '';
    const MAX_TOOL_ROUNDS = 6;

    const processToolCallArgs = {
      user,
      topicId: resolvedTopicId,
      abortController,
    };
    if (onToolStatus) {
      processToolCallArgs.onStatus = onToolStatus;
    }

    const loopResult = await runToolLoop({
      effectiveModelConfig,
      aiMessages,
      abortController,
      processToolCallArgs,
      promptBudget,
      maxToolRounds: MAX_TOOL_ROUNDS,
      loggerPrefix: 'ChatPipeline',
      getNudgeSourceText: () => finalQuery,
      onStreamChunk,
    });

    if (loopResult.aborted) throw { name: 'AbortError' };

    finalReply = loopResult.finalReply;
    totalAITokens += loopResult.totalAITokens || 0;
    totalEmbeddingTokens += loopResult.totalEmbeddingTokens || 0;
    const cacheCreationTokens = loopResult.cacheCreationTokens || 0;
    const cacheReadTokens = loopResult.cacheReadTokens || 0;
    const generatedMediaFiles = loopResult.generatedMedia || [];

    // Strip leftover tool-call syntax
    finalReply = stripToolTags(finalReply);

    const billableTokens = calculateBillableTokens({
      totalAITokens,
      promptTokens,
      finalReply,
      totalEmbeddingTokens,
      estimatedInputTokens,
      compressTokens,
      historySummaryTokens,
    });

    if (abortController.signal.aborted) throw { name: 'AbortError' };

    // ── 10. Cache the response ────────────────────────────────
    if (cacheResponse && !isIdentityQuestion) {
      await setCachedResponse(finalQuery, modelId, finalReply, queryVector, user?.id, resolvedTopicId);
    }

    // ── 11. Persist to DB ─────────────────────────────────────
    let savedUserMessageId = null;
    let savedAssistantMessageId = null;
    let persistError = null;

    if (!isAnonymous) {
      if (!resolvedTopicId) {
        const topicTitle = message.trim().slice(0, 60) + (message.length > 60 ? '...' : '');
        const { data: newTopic, error: topicError } = await supabase
          .from('topics')
          .insert({ user_id: user.id, title: topicTitle, model: modelId })
          .select('id')
          .single();

        if (topicError) {
          console.error('[ChatPipeline] Topic creation failed:', topicError.message);
        } else {
          resolvedTopicId = newTopic?.id;
        }
      }

      if (resolvedTopicId) {
        // Pass the array directly — JSONB column expects a JS array, not a stringified JSON.
        // Stringifying causes double-encoding, and on read the frontend gets a string, not an array.
        const generatedFilesValue = generatedMediaFiles.length > 0 ? generatedMediaFiles : [];
        const { data: savedMessages, error: msgError } = await supabase.from('messages').insert([
          { topic_id: resolvedTopicId, user_id: user.id, role: 'user', content: message, model: modelId, tokens_used: estimatedInputTokens },
          { topic_id: resolvedTopicId, user_id: user.id, role: 'assistant', content: finalReply, model: modelId, tokens_used: billableTokens, generated_files: generatedFilesValue },
        ]).select('id, role');

        if (msgError) {
          persistError = msgError;
          console.error('[ChatPipeline] Message insert error:', msgError.message);
        } else if (savedMessages) {
          for (const m of savedMessages) {
            if (m.role === 'user') savedUserMessageId = m.id;
            if (m.role === 'assistant') savedAssistantMessageId = m.id;
          }
        }

        await supabase.from('topics')
          .update({ updated_at: new Date().toISOString(), model: modelId })
          .eq('id', resolvedTopicId);
      }
    }

    // ── 12. Post-save memory embedding ───────────────────────
    if (postSaveEmbedding && !isAnonymous && resolvedTopicId && memoryMode === 'accurate') {
      const embedPromises = [];
      if (savedUserMessageId) {
        embedPromises.push(
          embedAndStoreMessage({
            userId: user.id, topicId: resolvedTopicId,
            messageId: savedUserMessageId, role: 'user',
            content: message, provider: modelConfig.provider,
          }).catch(err => { console.warn('[Memory] User msg embed failed:', err.message); return 0; })
        );
      }
      if (savedAssistantMessageId) {
        embedPromises.push(
          embedAndStoreMessage({
            userId: user.id, topicId: resolvedTopicId,
            messageId: savedAssistantMessageId, role: 'assistant',
            content: finalReply, provider: modelConfig.provider,
          }).catch(err => { console.warn('[Memory] Asst msg embed failed:', err.message); return 0; })
        );
      }
      if (embedPromises.length > 0) {
        const results = await Promise.all(embedPromises);
        const memoryEmbedTokens = results.reduce((sum, t) => sum + (t || 0), 0);
        if (memoryEmbedTokens > 0) {
          totalEmbeddingTokens += memoryEmbedTokens;
          console.log(`[Memory] Embedding tokens: ${memoryEmbedTokens}`);
        }
      }
    }

    // ── 13. Update user token usage ───────────────────────────
    if (user) {
      console.log(`[TokenTracking] AI=${totalAITokens} Embedding=${totalEmbeddingTokens} InputMsg=${estimatedInputTokens} Total=${billableTokens}`);
      await supabase.rpc('increment_user_tokens', { user_id: user.id, token_amount: billableTokens });
    }

    // ── 14. Log analytics ─────────────────────────────────────
    await logAnalytics({
      userId: user?.id,
      query: message,
      modelId,
      tokensUsed: billableTokens,
      isAnonymous,
      cacheHit: cacheReadTokens > 0,
      responseTimeMs: Date.now() - startTime,
    });

    // ── Return ────────────────────────────────────────────────
    return makePipelineResult({
      finalReply,
      billableTokens,
      totalAITokens,
      totalEmbeddingTokens,
      orchestratorBrain,
      queryCacheHit: false,
      cacheCreationTokens,
      cacheReadTokens,
      cacheHit: cacheReadTokens > 0,
      generatedMediaFiles,
      resolvedTopicId,
      persistError,
      estimatedInputTokens,
      compressTokens,
      historySummaryTokens,
      modelConfig,
      effectiveModelConfig,
      isIdentityQuestion,
      savedUserMessageId,
      savedAssistantMessageId,
      promptTokens,
    });
  } catch (err) {
    // Gracefully handle manual aborts
    if (err.name === 'AbortError' || abortController?.signal?.aborted) {
      return makePipelineResult({
        err,
        errorType: 'aborted',
        userMessage: 'Request aborted',
        resolvedTopicId: topicId,
      });
    }

    console.error('[ChatPipeline] Error:', err.message);
    const { errorType, userMessage } = classifyError(err.message);

    return makePipelineResult({
      err,
      errorType,
      userMessage,
      resolvedTopicId: topicId,
    });
  }
};

module.exports = { runChatPipeline, CANONICAL_CHAT_PIPELINE_FLAGS };
