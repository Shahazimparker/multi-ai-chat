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
const { CHAT_SEMANTIC_CACHE_THRESHOLD, ENABLE_ORCHESTRATOR_BRAIN } = require('../config/chatRuntime.config');
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
const { searchWeb } = require('./tools/webSearch.service');
const { extractUrls, readUrls } = require('./tools/urlReader.service');
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
 * @param {boolean}  [opts.forceWebSearch=false]
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
  // Opt-in: see ENABLE_ORCHESTRATOR_BRAIN in config/chatRuntime.config.js
  enableOrchestratorBrain: ENABLE_ORCHESTRATOR_BRAIN,
});
const PPT_THEME_OPTIONS = [
  { value: 'modern_corporate', label: 'Modern corporate' },
  { value: 'graphite_gold', label: 'Graphite gold' },
  { value: 'arctic_blue', label: 'Arctic blue' },
  { value: 'midnight_plum', label: 'Midnight plum' },
  { value: 'teal_glass', label: 'Teal glass' },
  { value: 'startup_bold', label: 'Startup bold' },
  { value: 'forest_night', label: 'Forest night' },
  { value: 'slate_coral', label: 'Slate coral' },
  { value: 'golden_age', label: 'Golden age' },
  { value: 'cobalt_bold', label: 'Cobalt bold' },
  { value: 'emerald_glass', label: 'Emerald glass' },
  { value: 'violet_tech', label: 'Violet tech' },
  { value: 'ocean_depth', label: 'Ocean depth' },
  { value: 'ruby_noir', label: 'Ruby noir' },
  { value: 'sandstone_editorial', label: 'Sandstone editorial' },
  { value: 'rose_creative', label: 'Rose creative' },
  { value: 'charcoal_lime', label: 'Charcoal lime' },
  { value: 'clean_minimal', label: 'Clean minimal' },
  { value: 'sunset_warm', label: 'Sunset warm' },
  { value: 'mono_editorial', label: 'Mono editorial' },
];

const PPT_SLIDE_COUNT_OPTIONS = [
  { value: '4', label: '4 slides' },
  { value: '6', label: '6 slides' },
  { value: '8', label: '8 slides' },
];

const PPT_AUDIENCE_OPTIONS = [
  { value: 'executives', label: 'Executives' },
  { value: 'team members', label: 'Team members' },
  { value: 'clients', label: 'Clients' },
];

const ARTIFACT_INTENTS = [
  {
    intent: 'generate_ppt',
    label: 'presentation',
    keywords: /\b(ppt|pptx|powerpoint|slide deck|slides|presentation)\b/,
    verbs: /\b(generate|create|make|build|prepare|draft)\b/,
    hasEnoughDetails: (text) => /\b(on|about|for)\s+.+/i.test(text),
    questions: (topicHint) => [
      { id: 'topic', label: 'Topic', kind: 'text', required: true, placeholder: 'Quarterly business review', value: topicHint },
      { id: 'title', label: 'Title', kind: 'text', required: false, placeholder: 'Q2 Business Review', value: '' },
      { id: 'slideCount', label: 'Slides', kind: 'select', required: true, value: '6', options: PPT_SLIDE_COUNT_OPTIONS },
      { id: 'theme', label: 'Theme', kind: 'select', required: true, value: 'modern_corporate', options: PPT_THEME_OPTIONS },
      { id: 'audience', label: 'Audience', kind: 'select', required: true, value: 'team members', options: PPT_AUDIENCE_OPTIONS },
    ],
  },
  {
    intent: 'generate_image',
    label: 'image',
    keywords: /\b(image|picture|photo|illustration|artwork|poster|logo|banner)\b/,
    verbs: /\b(generate|create|make|draw|design)\b/,
    hasEnoughDetails: (text) => /\b(of|for|showing|with)\s+.+/i.test(text),
    questions: (topicHint) => [
      { id: 'subject', label: 'Subject', kind: 'text', required: true, placeholder: 'Product launch hero image', value: topicHint },
      { id: 'style', label: 'Style', kind: 'text', required: true, placeholder: 'Modern 3D marketing illustration', value: '' },
      { id: 'usage', label: 'Usage', kind: 'text', required: false, placeholder: 'Website banner, social post, thumbnail', value: '' },
    ],
  },
  {
    intent: 'generate_pdf',
    label: 'PDF',
    keywords: /\bpdf\b/,
    verbs: /\b(generate|create|make|build|prepare|draft)\b/,
    hasEnoughDetails: (text) => /\b(on|about|for)\s+.+/i.test(text) && /\b(section|report|summary|proposal|invoice|resume)\b/i.test(text),
    questions: (topicHint) => [
      { id: 'documentType', label: 'Document type', kind: 'text', required: true, placeholder: 'Status report, proposal, invoice, handbook', value: '' },
      { id: 'topic', label: 'Topic', kind: 'text', required: true, placeholder: 'Project status report', value: topicHint },
      { id: 'sections', label: 'Sections', kind: 'text', required: true, placeholder: 'Summary, progress, risks, next steps', value: '' },
      { id: 'audience', label: 'Audience', kind: 'text', required: false, placeholder: 'Leadership team', value: '' },
    ],
  },
  {
    intent: 'generate_excel',
    label: 'Excel spreadsheet',
    keywords: /\b(excel|xlsx|spreadsheet|workbook)\b/,
    verbs: /\b(generate|create|make|build|prepare)\b/,
    hasEnoughDetails: (text) => /\b(tracker|sheet|workbook|table|budget|report)\b/i.test(text) && /\b(for|with|on)\s+.+/i.test(text),
    questions: (topicHint) => [
      { id: 'topic', label: 'Purpose', kind: 'text', required: true, placeholder: 'Sales tracker', value: topicHint },
      { id: 'sheets', label: 'Sheets', kind: 'text', required: true, placeholder: 'Overview, monthly sales, pipeline', value: '' },
      { id: 'columns', label: 'Columns', kind: 'text', required: true, placeholder: 'Date, region, revenue, owner', value: '' },
    ],
  },
  {
    intent: 'generate_docx',
    label: 'Word document',
    keywords: /\b(docx|word document|word file|document)\b/,
    verbs: /\b(generate|create|make|build|prepare|draft|write)\b/,
    hasEnoughDetails: (text) => /\b(on|about|for)\s+.+/i.test(text) && /\b(letter|proposal|report|contract|document|agreement)\b/i.test(text),
    questions: (topicHint) => [
      { id: 'topic', label: 'Topic', kind: 'text', required: true, placeholder: 'Proposal for new client onboarding', value: topicHint },
      { id: 'title', label: 'Title', kind: 'text', required: false, placeholder: 'Client Onboarding Proposal', value: '' },
      { id: 'sections', label: 'Sections', kind: 'text', required: true, placeholder: 'Introduction, scope, pricing, timeline', value: '' },
    ],
  },
  {
    intent: 'generate_csv',
    label: 'CSV file',
    keywords: /\b(csv)\b/,
    verbs: /\b(generate|create|make|build|prepare)\b/,
    hasEnoughDetails: (text) => /\b(with|columns|headers|data)\b/i.test(text),
    questions: (topicHint) => [
      { id: 'topic', label: 'Dataset', kind: 'text', required: true, placeholder: 'Monthly expenses', value: topicHint },
      { id: 'columns', label: 'Columns', kind: 'text', required: true, placeholder: 'Date, category, amount, note', value: '' },
      { id: 'sampleRows', label: 'Sample rows', kind: 'text', required: false, placeholder: '3-5 example rows or row style', value: '' },
    ],
  },
  {
    intent: 'generate_chart',
    label: 'chart',
    keywords: /\b(chart|graph|plot|dashboard)\b/,
    verbs: /\b(generate|create|make|build|prepare|draw)\b/,
    hasEnoughDetails: (text) => /\b(bar|line|pie|area|scatter)\b/i.test(text) || /\b(data|from|using)\s+.+/i.test(text),
    questions: (topicHint) => [
      { id: 'topic', label: 'Topic', kind: 'text', required: true, placeholder: 'Quarterly revenue growth', value: topicHint },
      { id: 'chartType', label: 'Chart type', kind: 'text', required: true, placeholder: 'Bar, line, pie, area', value: '' },
      { id: 'dataPoints', label: 'Data points', kind: 'text', required: true, placeholder: 'Q1 120, Q2 150, Q3 170', value: '' },
    ],
  },
  {
    intent: 'generate_html',
    label: 'HTML page',
    keywords: /\b(html|web page|landing page|site)\b/,
    verbs: /\b(generate|create|make|build|design)\b/,
    hasEnoughDetails: (text) => /\b(page|site|landing)\b/i.test(text) && /\b(for|with|about)\s+.+/i.test(text),
    questions: (topicHint) => [
      { id: 'topic', label: 'Page purpose', kind: 'text', required: true, placeholder: 'Product landing page', value: topicHint },
      { id: 'title', label: 'Title', kind: 'text', required: false, placeholder: 'Launch your team workspace', value: '' },
      { id: 'sections', label: 'Sections', kind: 'text', required: true, placeholder: 'Hero, features, pricing, CTA', value: '' },
      { id: 'style', label: 'Style', kind: 'text', required: false, placeholder: 'Clean startup, editorial, bold marketing', value: '' },
    ],
  },
  {
    intent: 'generate_json',
    label: 'JSON file',
    keywords: /\b(json)\b/,
    verbs: /\b(generate|create|make|build|prepare)\b/,
    hasEnoughDetails: (text) => /\b(schema|fields|array|object|sample|data)\b/i.test(text),
    questions: (topicHint) => [
      { id: 'topic', label: 'Purpose', kind: 'text', required: true, placeholder: 'Product catalog data', value: topicHint },
      { id: 'schema', label: 'Fields', kind: 'text', required: true, placeholder: 'id, name, price, category', value: '' },
      { id: 'sampleCount', label: 'Items', kind: 'text', required: false, placeholder: '5 sample items', value: '' },
    ],
  },
  {
    intent: 'generate_md',
    label: 'Markdown document',
    keywords: /\b(markdown|md file|readme|README)\b/,
    verbs: /\b(generate|create|make|build|prepare|draft|write)\b/,
    hasEnoughDetails: (text) => /\b(readme|guide|notes|documentation|markdown)\b/i.test(text) && /\b(for|about|with)\s+.+/i.test(text),
    questions: (topicHint) => [
      { id: 'topic', label: 'Topic', kind: 'text', required: true, placeholder: 'Project setup guide', value: topicHint },
      { id: 'title', label: 'Title', kind: 'text', required: false, placeholder: 'Getting Started', value: '' },
      { id: 'sections', label: 'Sections', kind: 'text', required: true, placeholder: 'Overview, install, usage, troubleshooting', value: '' },
    ],
  },
];

const detectArtifactIntent = (text = '') => {
  const normalized = String(text).toLowerCase();
  // Skip artifact detection when the message is a file upload notification
  // (e.g. "[File uploaded: report.pdf]" or "📎 report.pdf")
  // These are short auto-generated messages where filename extensions (pdf, docx, csv, json, md, etc.)
  // falsely trigger artifact intent detection, causing unwanted clarification popups.
  if (/\[file uploaded:|📎/.test(normalized)) return null;
  return ARTIFACT_INTENTS.find((entry) => entry.keywords.test(normalized) && (entry.verbs.test(normalized) || normalized.trim().split(/\s+/).length <= 8)) || null;
};

const looksLikeClarificationResponse = (text = '') =>
  /\[ARTIFACT DETAILS\]/i.test(String(text));

const extractArtifactTopic = (text = '') => {
  const normalized = String(text).trim();
  if (!normalized) return '';

  const patterns = [
    /\b(?:on|about|for)\s+(.+?)(?:\s+(?:for|to)\s+(?:executives|clients|students|team members|investors))?$/i,
    /\btopic\s*[:=-]\s*(.+)$/i,
    /\btitle\s*[:=-]\s*(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) return match[1].trim().replace(/[.?!]+$/, '');
  }

  return '';
};

const buildArtifactClarificationEvent = (artifact, rawMessage = '') => {
  const topicHint = extractArtifactTopic(rawMessage);
  return {
    type: 'clarification_request',
    intent: artifact.intent,
    message: `Select the ${artifact.label} details, then continue.`,
    formId: `${artifact.intent}-clarification`,
    questions: artifact.questions(topicHint),
  };
};

// Per-request ceiling for unauthenticated callers. Mirrors the value the
// tokenCheck middleware advertises, which nothing previously enforced.
const ANONYMOUS_TOKEN_LIMIT = Number.parseInt(process.env.ANONYMOUS_TOKEN_LIMIT, 10) || 10000;

// Hard ceiling on client-supplied history turns, independent of token budget —
// bounds the work done parsing/estimating before the budget trim can apply.
const MAX_CLIENT_HISTORY_TURNS = 20;

/**
 * Normalise untrusted client-supplied chat history into role/content pairs that
 * fit the history token budget. Keeps the most recent turns.
 */
const sanitizeClientHistory = (history, tokenBudget) => {
  const recent = history.slice(-MAX_CLIENT_HISTORY_TURNS);

  const normalized = [];
  for (const entry of recent) {
    const content = typeof entry?.content === 'string' ? entry.content : '';
    if (!content) continue;
    normalized.push({
      role: entry?.role === 'assistant' ? 'assistant' : 'user',
      content,
    });
  }

  // Walk backwards so the newest turns survive a tight budget.
  const budget = Math.max(0, tokenBudget || 0);
  const kept = [];
  let used = 0;
  for (let i = normalized.length - 1; i >= 0; i--) {
    const cost = estimateTokens(normalized[i].content) + 4;
    if (used + cost > budget) break;
    kept.unshift(normalized[i]);
    used += cost;
  }
  return kept;
};

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
  suggestedModels: null,
  recommendedModelId: null,
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
    forceWebSearch = false,
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
  // Web toggle is additive: always include internal retrieval with web search.
  const effectiveRagEnabled = Boolean(ragEnabled || forceWebSearch);

  try {
    // ── 1. Validate model ──────────────────────────────────────
    const modelConfig = MODELS[modelId];
    let effectiveModelConfig = providerModelId
      ? { ...modelConfig, model: providerModelId }
      : modelConfig;
    if (!modelConfig) {
      return makePipelineResult({
        err: new Error(`Unknown model: ${modelId}`),
        errorType: 'invalid_model',
        userMessage: `Unknown model: ${modelId}`,
      });
    }

    // ── 1b. Verify topic ownership ────────────────────────────
    // `topicId` arrives straight from the request body. Every downstream reader
    // (history, summaries, cache, RAG, uploaded files) filters on topic_id alone,
    // so without this check any authenticated caller could pass another user's
    // topic id and have that conversation loaded into their prompt — and their
    // own turns written back into the victim's topic.
    if (topicId) {
      if (isAnonymous || !user?.id) {
        // Anonymous callers own no topics. Drop the id rather than letting it
        // reach the cache / RAG / file lookups.
        resolvedTopicId = null;
      } else {
        const { data: ownedTopic, error: topicLookupError } = await supabase
          .from('topics')
          .select('id')
          .eq('id', topicId)
          .eq('user_id', user.id)
          .maybeSingle();

        // A malformed id fails the uuid cast and surfaces as an error here;
        // both cases get the same response so this can't confirm existence.
        if (topicLookupError || !ownedTopic) {
          if (topicLookupError) {
            console.warn('[ChatPipeline] Topic ownership lookup failed:', topicLookupError.message);
          }
          return makePipelineResult({
            err: new Error('Topic not found'),
            errorType: 'topic_not_found',
            userMessage: 'Topic not found.',
            modelConfig,
            effectiveModelConfig,
            resolvedTopicId: null,
          });
        }
      }
    }

    const estimatedInputTokens = estimateTokens(message);
    const orchestratorBrain = enableOrchestratorBrain
      ? await runOrchestratorBrain({
          modelId,
          providerModelId,
          message,
          image,
          topicId: resolvedTopicId,
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

    // The brain's provider calls are real spend, so they seed the AI token total
    // and flow into billing/analytics like any other call. Zero when it is off,
    // which is the default — so this is a no-op on the standard path.
    let totalAITokens = orchestratorBrain?.tokensUsed || 0;

    // NOTE: a model-switch gate used to sit here, returning `model_switch_required`
    // when the orchestrator routed an artifact intent to a weaker model. It was
    // retired because every model now generates artifacts via the text-tag path,
    // so `orchestratorBrain.routingDecision` is advisory only and no longer blocks.

    // ── 2. Prompt budget ──────────────────────────────────────
    let promptBudget = createPromptBudget(modelConfig);
    if (dynamicBudgetEnabled && resolvedTopicId && user) {
      try {
        const turnCount = await getTopicTurnCount(resolvedTopicId);
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

    // Anonymous callers have no `per_query_limit` row, so the checks below skip
    // them entirely. ANONYMOUS_TOKEN_LIMIT stands in as their per-request cap —
    // without it an unauthenticated caller could spend without bound.
    const effectivePerQueryLimit = user?.per_query_limit || ANONYMOUS_TOKEN_LIMIT;
    const limitEnabled = perQueryLimitEnabled || isAnonymous || !user;

    if (limitEnabled && estimatedInputTokens > effectivePerQueryLimit) {
      return makePipelineResult({
        err: new Error(`Query too long. Max ${effectivePerQueryLimit} tokens per query. Your query is ~${estimatedInputTokens} tokens.`),
        errorType: 'query_too_long',
        userMessage: `Query too long. Max ${effectivePerQueryLimit} tokens per query. Your query is ~${estimatedInputTokens} tokens.`,
        estimatedInputTokens,
        totalAITokens,
        billableTokens: totalAITokens,
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
      const cachedReply = await getCachedResponse(compressedQuery, modelId, user?.id, resolvedTopicId);
      if (cachedReply) {
        return makePipelineResult({
          finalReply: cachedReply,
          // A cache hit is free, but any brain tokens already spent are not.
          billableTokens: totalAITokens,
          totalAITokens,
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

    if (effectiveRagEnabled) {
      if (abortController.signal.aborted) throw { name: 'AbortError' };
      const embedResult = await embedText(finalQuery, embedProvider, 3, abortController.signal, user?.id);
      if (embedResult) {
        queryVector = embedResult.vector;
        totalEmbeddingTokens += embedResult.tokensUsed;
      }

      // Semantic cache lookup (same embedding vector)
      {
        const semanticCachedReply = await getSemanticCachedResponse(queryVector, modelId, CHAT_SEMANTIC_CACHE_THRESHOLD, user?.id, resolvedTopicId);
        if (semanticCachedReply) {
          return makePipelineResult({
            finalReply: semanticCachedReply,
            billableTokens: totalAITokens,
            totalAITokens,
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
    let forcedWebContext = '';
    let urlContext = '';
    let fileResults = [];
    let totalFileCount = 0;

    if (effectiveRagEnabled) {
      if (abortController.signal.aborted) throw { name: 'AbortError' };
      const [ragCtx, fileData] = await Promise.all([
        buildRAGContext(
          finalQuery,
          embedProvider,
          abortController.signal,
          queryVector,
          { tokenBudget: promptBudget.ragTokens, topicId: resolvedTopicId, userId: user?.id }
        ),
        listUserFiles(user?.id, resolvedTopicId),
      ]);
      ragContext = ragCtx;
      const normalizedFileData = Array.isArray(fileData)
        ? { files: fileData, totalCount: fileData.length }
        : (fileData || {});
      fileResults = normalizedFileData.files || [];
      totalFileCount = normalizedFileData.totalCount || fileResults.length;
    }

    if (forceWebSearch) {
      onToolStatus?.({
        type: 'status',
        tool: 'web_search',
        message: 'searching on web',
      });
      const webResults = await searchWeb(finalQuery);
      forcedWebContext = webResults.length > 0
        ? `[WEB SEARCH RESULTS for "${finalQuery}"]\n${webResults.map((r) => `- [${r.title}](${r.url}): ${r.snippet}`).join('\n')}\n[END WEB SEARCH RESULTS]`
        : `[WEB SEARCH RESULTS for "${finalQuery}"]\nNo results found.\n[END WEB SEARCH RESULTS]`;
    }

    const detectedUrls = extractUrls(finalQuery);
    if (detectedUrls.length > 0) {
      onToolStatus?.({
        type: 'status',
        tool: 'url_reader',
        message: 'reading provided URL(s)',
      });
      const pages = await readUrls(detectedUrls);
      if (pages.length > 0) {
        const rawContext = pages
          .map((page, idx) => `[URL SOURCE ${idx + 1}]
Title: ${page.title}
URL: ${page.url}
Provider: ${page.source}
Content:
${page.text}`)
          .join('\n\n');
        urlContext = trimTextByTokens(rawContext, Math.max(800, Math.floor(promptBudget.ragTokens * 0.8)));
      }
    }

    const fileContext = buildFileContext(fileResults, totalFileCount);

    // ── 7. History context ────────────────────────────────────
    const historyOpts = {
      memoryMode,
      historyLimit,
      userId: user?.id,
      modelMaxTokens: modelConfig.maxTokens || 8000,
    };
    if (historyTokenBudget !== undefined) {
      historyOpts.tokenBudget = historyTokenBudget;
    }
    const { context: historyContext, summaryTokens: historySummaryTokens, _debug } = await buildContextMessages(
      finalQuery,
      resolvedTopicId,
      historyOpts,
      abortController.signal
    );

    if (_debug) {
      console.log(`[Dynamic Budget] Complexity: ${_debug.complexity.toFixed(2)}, Turns: ${_debug.turnCount}, Allocated: ${_debug.allocatedBudget} tokens`);
    }

    // ── 7.5 Cross-chat memory (accurate mode, message only) ───
    let memoryContext = '';
    if (memoryEnabled && effectiveRagEnabled && memoryMode === 'accurate' && queryVector && user?.id) {
      memoryContext = await searchMemory(queryVector, user.id, {
        queryText: finalQuery,
        excludeTopicId: resolvedTopicId,
        topK: 5,
        threshold: 0.5,
      });
    }

    // ── 8. Build AI messages ──────────────────────────────────
    const aiMessages = [];
    const askClarifyingDirective = `\n\n## IMPORTANT: Ask Clarifying Questions First\nBefore using any GENERATE_* tool (GENERATE_PPT, GENERATE_IMAGE, GENERATE_HTML, GENERATE_PDF, GENERATE_EXCEL, GENERATE_DOCX, GENERATE_CHART, GENERATE_CSV):\n- If the user's request lacks critical details (title, theme, structure, layout, purpose, content), ask clarifying questions FIRST\n- Do NOT immediately jump to generation with vague or insufficient information\n- Ask 2-4 specific, targeted questions to get the details you need\n- Only use the GENERATE_* tool AFTER the user has provided sufficient context\n- This ensures the output matches what the user actually wants\n- Wait for the user's response before proceeding with generation`;
    const toolLines = [
      '1. Web Search: [WEB_SEARCH:query="your search query"]',
      '2. Generate Image (DALL-E 3): [GENERATE_IMAGE:prompt=detailed image description here]',
      '   - Use when the user asks you to generate, create, or draw an image/picture/photo',
      '   - Write the most descriptive prompt possible for best results',
      `3. Generate PowerPoint: [GENERATE_PPT]{"title":"Presentation Title","subtitle":"Optional subtitle","theme":"emerald_glass","slides":[{"title":"Slide Title","layout":"cards","bullets":["Point 1","Point 2","Point 3"]},{"title":"Roadmap","layout":"timeline","bullets":["Now","Next","Later"]},{"title":"KPIs","layout":"kpi_dashboard","bullets":["Revenue: $2.4M","Margin: 58%","NPS: 51"]}]}[/GENERATE_PPT]`,
      '   - Use when the user asks you to create a presentation, slides, or PowerPoint',
      '   - Include 4-8 content slides with varied layouts for visual quality',
      '   - Allowed themes: modern_corporate, startup_bold, clean_minimal, emerald_glass, sunset_warm, charcoal_lime, sandstone_editorial, ruby_noir, violet_tech, ocean_depth, rose_creative, mono_editorial, arctic_blue, forest_night, golden_age, midnight_plum, slate_coral, graphite_gold, teal_glass, cobalt_bold',
      '   - Allowed slide layouts: title_bullets, two_column, cards, quote, data_story, timeline, process_steps, comparison_split, swot_grid, kpi_dashboard, checklist, section_break, statistics_strip, faq, table_like, hero_statement, agenda',
      '   - hero_statement: dramatic full-dark slide with one large bold central statement and optional tagline — ideal for key insights, mission statements, or impactful closing slides',
      '   - agenda: numbered agenda list with styled rows and badges — use for roadmaps, meeting outlines, or ordered topic lists',
      '   - Vary layouts: do not repeat the same layout more than 2 times in one deck',
      '   - Every slide needs a "title" plus either "bullets" (array) or "content" (string)',
      'Wait for the tool result before continuing your response.',
    ];
    const generalToolsDirective = `${askClarifyingDirective}\n\n## General Tools\nYou have access to the following tools. Output EXACTLY the tags shown — no extra text inside the tags:\n${toolLines.join('\n')}`;

    const runtimeIdentity = `MODEL_IDENTITY: ${modelConfig.label} | provider=${effectiveModelConfig.provider} | model=${effectiveModelConfig.model}`;
    const identityDirective = identityCheckEnabled && isIdentityQuestion
      ? `\n\nIf the user asks what model/company you are, reply EXACTLY with:\n${runtimeIdentity}`
      : '';

    const staticSystem = `You are a helpful AI assistant. Be concise, accurate, and helpful.\n${runtimeIdentity}${identityDirective}${generalToolsDirective}`;
    const systemSections = [staticSystem];
    if (ragContext) systemSections.push(`## Retrieved Context\n${ragContext}`);
    if (forcedWebContext) systemSections.push(`## Web Search Context\n${forcedWebContext}`);
    if (urlContext) systemSections.push(`## URL Context\n${urlContext}`);
    if (fileContext) systemSections.push(`## File Context\n${fileContext}`);
    if (memoryContext) systemSections.push(memoryContext);
    aiMessages.push({ role: 'system', content: systemSections.join('\n\n') });

    // History. The `history` fallback is client-supplied (anonymous sessions have
    // no server-side topic), so it is untrusted: cap the number of turns, coerce
    // each entry to a known shape, and trim it to the history token budget. An
    // uncapped array here let a caller push megabytes straight into the prompt.
    if (historyContext && historyContext.length > 0) {
      aiMessages.push(...historyContext);
    } else if (Array.isArray(history) && history.length > 0) {
      aiMessages.push(...sanitizeClientHistory(history, promptBudget.historyTokens));
    }

    // Current user message
    const userContent = image
      ? [
          { type: 'text', text: finalQuery || 'Analyze this image' },
          { type: 'image_url', image_url: { url: image } },
        ]
      : trimTextByTokens(finalQuery, promptBudget.queryTokens);
    aiMessages.push({ role: 'user', content: userContent });

    const artifactIntent = !image ? detectArtifactIntent(finalQuery) : null;
    if (artifactIntent && !looksLikeClarificationResponse(finalQuery) && !artifactIntent.hasEnoughDetails(finalQuery)) {
      onToolStatus?.(buildArtifactClarificationEvent(artifactIntent, finalQuery));
      return makePipelineResult({
        finalReply: '',
        billableTokens: totalAITokens,
        totalAITokens,
        totalEmbeddingTokens,
        orchestratorBrain,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cacheHit: false,
        generatedMediaFiles: [],
        resolvedTopicId,
        persistError: null,
        estimatedInputTokens,
        compressTokens,
        historySummaryTokens,
        modelConfig,
        effectiveModelConfig,
        isIdentityQuestion,
        promptTokens: 0,
      });
    }

    const promptTokens = estimateMessagesTokens(aiMessages);

    if (limitEnabled && promptTokens > effectivePerQueryLimit) {
      return makePipelineResult({
        err: new Error(`Query context too large after RAG/history. Max ${effectivePerQueryLimit} tokens per query. Current prompt is ~${promptTokens} tokens.`),
        errorType: 'context_too_large',
        userMessage: `Query context too large after RAG/history. Max ${effectivePerQueryLimit} tokens per query. Current prompt is ~${promptTokens} tokens.`,
        promptTokens,
        estimatedInputTokens,
        compressTokens,
        historySummaryTokens,
        totalAITokens,
        billableTokens: totalAITokens,
        modelConfig,
        effectiveModelConfig,
        isIdentityQuestion,
        orchestratorBrain,
        resolvedTopicId,
      });
    }

    // ── 9. Tool-call loop ─────────────────────────────────────
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

          // ── Backfill topic_id on orphaned files uploaded before topic existed ──
          // Files uploaded (e.g. via sendMessage flow) before the topic is created
          // have topic_id = NULL. Link them to the newly created topic so
          // listUserFiles / searchUserFilesRAG find them on subsequent messages.
          try {
            const { error: backfillErr1 } = await supabase
              .from('uploaded_files_rag')
              .update({ topic_id: resolvedTopicId })
              .eq('user_id', user.id)
              .is('topic_id', null)
              .gte('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString()); // last 10 min
            if (backfillErr1) {
              console.warn('[ChatPipeline] File topic backfill error (rag):', backfillErr1.message);
            } else {
              console.log(`[ChatPipeline] Backfilled topic_id for uploaded_files_rag → ${resolvedTopicId}`);
            }
          } catch (backfillErr) {
            console.warn('[ChatPipeline] File topic backfill failed (rag):', backfillErr.message);
          }

          // Also backfill uploaded_files (used by search_uploaded_files RPC)
          try {
            const { error: backfillErr2 } = await supabase
              .from('uploaded_files')
              .update({ topic_id: resolvedTopicId })
              .eq('user_id', user.id)
              .is('topic_id', null)
              .gte('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString());
            if (backfillErr2) {
              console.warn('[ChatPipeline] File topic backfill error (files):', backfillErr2.message);
            }
          } catch (backfillErr2) {
            console.warn('[ChatPipeline] File topic backfill failed (files):', backfillErr2.message);
          }
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
            content: message, provider: 'openrouter',
          }).catch(err => { console.warn('[Memory] User msg embed failed:', err.message); return 0; })
        );
      }
      if (savedAssistantMessageId) {
        embedPromises.push(
          embedAndStoreMessage({
            userId: user.id, topicId: resolvedTopicId,
            messageId: savedAssistantMessageId, role: 'assistant',
            content: finalReply, provider: 'openrouter',
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
        resolvedTopicId,
      });
    }

    console.error('[ChatPipeline] Error:', err.message);
    const { errorType, userMessage } = classifyError(err.message);

    return makePipelineResult({
      err,
      errorType,
      userMessage,
      resolvedTopicId,
    });
  }
};

module.exports = { runChatPipeline, CANONICAL_CHAT_PIPELINE_FLAGS };
