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
const { searchUserFilesRAG, getFileContent, listUserFiles } = require('../services/fileUpload.service');
const { logAnalytics } = require('../services/analytics.service');
const { queryBusinessDB, buildSchemaContext, buildMinimalSchemaContext, getTableSchema, isConnected, initBusinessDB } = require('../services/businessDb.service');

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
// ── Business DB connection status — managed by businessDb.service.js ──
let bizDbConnected = null;
let bizDbSchemaText = '';
let bizDbMinimalSchemaText = '';

const reserveToolLoopBudget = (promptBudget, reserveRatio = 0.15) => {
  const toolReserveTokens = Math.min(1400, Math.max(300, Math.floor(promptBudget.maxPromptTokens * reserveRatio)));
  const availableContextTokens = Math.max(900, promptBudget.maxPromptTokens - toolReserveTokens);
  const scale = Math.min(1, availableContextTokens / promptBudget.maxPromptTokens);

  return {
    ...promptBudget,
    toolReserveTokens,
    contextBudgetTokens: availableContextTokens,
    systemTokens: Math.max(100, Math.floor(promptBudget.systemTokens * scale)),
    historyTokens: Math.max(200, Math.floor(promptBudget.historyTokens * scale)),
    ragTokens: Math.max(200, Math.floor(promptBudget.ragTokens * scale)),
    fileTokens: Math.max(150, Math.floor(promptBudget.fileTokens * scale)),
    queryTokens: Math.max(120, Math.floor(promptBudget.queryTokens * scale)),
  };
};

// Init on module load (shared singleton — safe to call multiple times)
(async () => {
  const state = await initBusinessDB();
  bizDbConnected = state.connected;
  bizDbSchemaText = state.schemaText;
  bizDbMinimalSchemaText = state.minimalSchemaText;
})();

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
    // All file names listed (minimal tokens). AI has two tools:
    // 1. [SEARCH_FILES:query=<text>] — semantic search across uploaded files, returns brief snippets
    // 2. [GET_FILE:id=<file_id>] — fetch full file content on demand
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
    // Static part — cacheable across requests in the same topic
    // dbOnly=true  → full schema (all columns) for direct SQL writing
    // dbOnly=false → NO database information at all
    const selectedSchema = dbOnly ? bizDbMinimalSchemaText : '';
    const baseBizRules = bizDbConnected && selectedSchema
      ? `\n\n## Business Database Access\nYou have read-only access to a business database via [QUERY_DB] tool.\n\n${selectedSchema}`
      : '';

    const dbOnlyRules = baseBizRules + `\n\n🔒 ONLY DB MODE (ACTIVE):\n- For ANY business question — ALWAYS use [QUERY_DB] to get LIVE data.\n- You CANNOT use your training data for business facts, numbers, or answers.\n- There is NO RAG/cache. Every query is live.\n- If [QUERY_DB] returns empty — say "No data found in database."\n- NEVER fabricate or guess data. Only present what the DB returns.\n- NEVER call external APIs for business data.\n- NEVER show the SQL query text to the user — only present the formatted results.\n- Always run the query to the database with concise and proper syntax — never show placeholder or sample data before querying.\n- Format results as tables for structured data.`;

    const relaxedBizRules = baseBizRules + `\n\n📋 RULES:\n- When the user asks about business data — query the DB using [QUERY_DB].\n- You may use your training knowledge alongside DB results.\n- If [QUERY_DB] returns empty, say "No data found in database."\n- NEVER fabricate data that should come from the DB.\n- NEVER call external APIs for business data.\n- Format results as tables for structured data.`;

    const bizDbDirective = bizDbConnected && selectedSchema
      ? (dbOnly ? dbOnlyRules : relaxedBizRules)
      : '';

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

    // ── 9. Call AI ───────────────────────────────────────────
    let reply, tokensUsed;
    let finalReply = '';
    let dbQueried = false;
    let lastDbResultBlock = '';

    // Tool-call loop: AI can search files, request full content, or query business DB
    const MAX_TOOL_ROUNDS = 5;
    // Track the index where tool-round messages start so we can trim oldest rounds
    // if aiMessages grows too large (memory + token budget protection).
    const TOOL_ROUND_START = aiMessages.length;
    const MAX_TOOL_TOKENS = Math.floor(promptBudget.maxPromptTokens * 0.5); // 50% of budget for tool rounds

    const trimOldestToolRounds = () => {
      const estimatedToolTokens = estimateMessagesTokens(aiMessages.slice(TOOL_ROUND_START));
      if (estimatedToolTokens <= MAX_TOOL_TOKENS) return;

      // Remove the oldest pair (assistant + user) from tool rounds
      // Keep removing until under budget — ensures at least one tool round survives
      while (aiMessages.length > TOOL_ROUND_START + 2) {
        const oldPairTokens = estimateTokens(aiMessages[TOOL_ROUND_START].content || '') +
                               estimateTokens(aiMessages[TOOL_ROUND_START + 1].content || '') + 8;
        aiMessages.splice(TOOL_ROUND_START, 2); // remove oldest assistant+user pair
        console.log(`[Tool] Trimmed oldest tool round (~${oldPairTokens} tokens) — ${aiMessages.length - TOOL_ROUND_START} tool messages remain`);

        if (estimateMessagesTokens(aiMessages.slice(TOOL_ROUND_START)) <= MAX_TOOL_TOKENS) break;
      }
    };

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await dispatchToAI(effectiveModelConfig, aiMessages, abortController.signal);
      reply = result.text;
      tokensUsed = result.tokensUsed;
      totalAITokens += tokensUsed || 0;  // ← accumulate ALL rounds
      if (abortController.signal.aborted) return;

      // Check for SEARCH_FILES tool call
      const searchMatch = reply.match(/\[SEARCH_FILES:query=([^\]]+)\]/);
      if (searchMatch) {
        const query = searchMatch[1].trim();
        console.log(`[Tool] AI searching files: query="${query}"`);

        const searchResult = await searchUserFilesRAG(query, user?.id, topicId, abortController.signal);
        const searchResults = searchResult.results || [];
        totalEmbeddingTokens += searchResult.embedTokens || 0;  // ← use actual embedding tokens from API

        const resultBlock = searchResults.length > 0
          ? `[SEARCH RESULTS for "${query}"]\n${searchResults
              .map(r => `- ${r.file_name} (id: ${r.file_id}): ${r.chunk_text.slice(0, 300)}`)
              .join('\n')}\n[END SEARCH RESULTS]`
          : `[SEARCH RESULTS for "${query}"]\nNo matching files found.\n[END SEARCH RESULTS]`;

        aiMessages.push({ role: 'assistant', content: reply.replace(searchMatch[0], '').trim() || `[Searching files for "${query}"]` });
        aiMessages.push({ role: 'user', content: resultBlock });
        trimOldestToolRounds(); // ← prevent unbounded memory/token growth
        continue;
      }

      // Check for GET_FILE tool call
      const getFileMatch = reply.match(/\[GET_FILE:id=([^\]]+)\]/);
      if (getFileMatch) {
        const fileId = getFileMatch[1].trim();
        console.log(`[Tool] AI requested file content: id=${fileId}`);

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
        trimOldestToolRounds(); // ← prevent unbounded memory/token growth
        continue;
      }

      // Check for GET_SCHEMA tool call — AI requests column schema for specific tables
      // Supports both formats: [GET_SCHEMA:tables] and <GET_SCHEMA>tables</GET_SCHEMA>
      let getSchemaMatch = reply.match(/\[GET_SCHEMA:([^\]]+)\]/);
      if (!getSchemaMatch) {
        getSchemaMatch = reply.match(/<GET_SCHEMA>([^<]+)<\/GET_SCHEMA>/);
      }
      if (getSchemaMatch && bizDbConnected) {
        const tableNames = getSchemaMatch[1].split(',').map(s => s.trim());
        console.log(`[Tool] AI requesting schema for: ${tableNames.join(', ')}`);

        const schemaText = await getTableSchema(tableNames);
        aiMessages.push({
          role: 'assistant',
          content: reply.replace(getSchemaMatch[0], '').trim() || `[Getting schema for ${tableNames.join(', ')}...]`
        });
        aiMessages.push({
          role: 'user',
          content: schemaText + '\n\nNow write your SQL query using the exact column names shown above.'
        });
        trimOldestToolRounds(); // ← prevent unbounded memory/token growth
        continue;
      }

      // Check for QUERY_DB tool call
      // Flexible matcher — handles all known AI formats:
      //   [QUERY_DB]sql[/QUERY_DB]
      //   [QUERY_DB] <SQL_QUERY>sql</SQL_QUERY>
      //   [QUERY_DB] <SQL_QUERY>sql</QUERY_DB>
      //   <QUERY_DB>sql</QUERY_DB>
      let queryDbMatch = reply.match(/\[QUERY_DB\]\s*(?:<SQL_QUERY>\s*)?([\s\S]*?)\s*(?:\[\/QUERY_DB\]|<\/SQL_QUERY>|<\/QUERY_DB>)/);
      if (!queryDbMatch) {
        queryDbMatch = reply.match(/<QUERY_DB>\s*(?:<SQL_QUERY>\s*)?([\s\S]*?)\s*<\/QUERY_DB>/);
      }
      if (queryDbMatch && bizDbConnected) {
        const sql = queryDbMatch[1].trim();
        console.log(`[Tool] AI querying business DB:\n${sql}`);

        try {
          const dbResults = await queryBusinessDB(sql);
          const resultCount = Array.isArray(dbResults) ? dbResults.length : 0;

          let resultBlock;
          if (resultCount === 0) {
            resultBlock = `[QUERY DB RESULTS]\nNo results found for the query.\n[END RESULTS]\n\nThe data might not exist in the database. Ask the user to clarify or check if they meant something else.`;
          } else {
            const preview = JSON.stringify(dbResults.slice(0, 20), null, 2);
            const truncated = resultCount > 20 ? `\n(Showing 20 of ${resultCount} results)` : '';
            resultBlock = `[QUERY DB RESULTS - ${resultCount} rows]${truncated}\n\`\`\`json\n${preview}\n\`\`\`\n[END RESULTS]\n\nBased on these results, answer the user's question. Use tables for structured data.`;
          }
          dbQueried = true;
          lastDbResultBlock = resultBlock;

          aiMessages.push({
            role: 'assistant',
            content: reply.replace(queryDbMatch[0], '').trim() || `[Querying business database...]`
          });
          aiMessages.push({ role: 'user', content: resultBlock });
          trimOldestToolRounds(); // ← prevent unbounded memory/token growth
          continue;
        } catch (dbErr) {
          console.error(`[Tool] DB query failed: ${dbErr.message}`);
          aiMessages.push({
            role: 'assistant',
            content: reply.replace(queryDbMatch[0], '').trim() || `[Attempting to query database...]`
          });
          aiMessages.push({
            role: 'user',
            content: `[QUERY DB ERROR]\n${dbErr.message}\n[END ERROR]\n\nPlease fix your SQL query and try again. Make sure table and column names are correct. Use DESCRIBE_TABLES if you need to check the schema.`
          });
          trimOldestToolRounds(); // ← prevent unbounded memory/token growth
          continue;
        }
      }

      // dbOnly enforcement: force AI to query DB before answering
      if (dbOnly && !dbQueried && !reply.includes('[QUERY_DB]') && !reply.includes('<QUERY_DB>')) {
        aiMessages.push({ role: 'assistant', content: reply });
        aiMessages.push({ role: 'user', content: '[SYSTEM] You answered without querying the database. In dbOnly mode, you MUST query the database before answering. Write [QUERY_DB] with your SQL query now.' });
        trimOldestToolRounds(); // ← prevent unbounded memory/token growth
        continue;
      }

      // No tool call — done
      finalReply = reply;
      break;
    }

    if (!finalReply) {
      finalReply = reply || '';
    }

    // Fallback: if AI exhausted rounds without producing a final answer, use last DB result
    if (dbQueried && lastDbResultBlock && (!finalReply || finalReply.length < 20)) {
      finalReply = `📊 **Database Results:**\n\n${lastDbResultBlock.replace(/\[QUERY DB RESULTS[^\]]*\]/g, '').replace(/\[END RESULTS\][\s\S]*$/, '').replace(/```json\n?/g, '```').trim()}\n\n*AI ran out of tool rounds. Raw results shown above.*`;
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
    if (bizDbConnected && dbOnly && finalReply) {
      finalReply = finalReply
        .replace(/\[QUERY_DB\][\s\S]*?(?:\[\/QUERY_DB\]|<\/SQL_QUERY>|<\/QUERY_DB>)/g, '')
        .replace(/<QUERY_DB>[\s\S]*?<\/QUERY_DB>/g, '')
        .replace(/\[GET_SCHEMA:[^\]]+\]/g, '')
        .replace(/<GET_SCHEMA>[^<]+<\/GET_SCHEMA>/g, '')
        .replace(/```sql[\s\S]*?```/g, '')
        .trim();
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

    const messageText = err.message || '';
    let errorType = 'unknown';
    let userMessage = 'The selected LLM is temporarily unavailable.';

    if (/413|too large|request too large/i.test(messageText)) {
      errorType = 'request_too_large';
      userMessage = 'This model does not support such a large request. Please select another model with a higher token limit and try again.';
    } else if (/quota|insufficient|credit|billing|exceeded/i.test(messageText)) {
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
