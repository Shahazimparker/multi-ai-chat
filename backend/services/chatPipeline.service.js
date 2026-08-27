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
const { MODELS, RETIRED_MODELS } = require('../config/models');
const { CHAT_SEMANTIC_CACHE_THRESHOLD, ENABLE_ORCHESTRATOR_BRAIN, CHAT_TIME_BUDGET_MS } = require('../config/chatRuntime.config');
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
const { resolveTimeZone, buildTemporalContext, renderTemporalSystemBlock } = require('./temporalContext.service');
const { runToolLoop } = require('./toolLoop.service');
const { stripToolTags, classifyError } = require('./chatCleanup.service');
const { searchWeb } = require('./tools/webSearch.service');
const { extractUrls, readUrls } = require('./tools/urlReader.service');
const { extractCollectionMentions, searchKnowledgeCollections } = require('./rag2.service');
const { DEFAULT_PROVIDER, spaceForProvider } = require('../config/embedding');
const { listCollections } = require('./knowledgeCollection.service');
const {
  createPromptBudget,
  createDynamicPromptBudget,
  calculateComplexityScore,
  getTopicTurnCount,
  estimateTokens,
  trimTextByTokens,
} = require('./tokenBudget.service');
const {
  createContextWindow,
  fitPromptToWindow,
  describeFitReport,
  toolLoopHeadroom,
  mergeVolatileIntoQuery,
  VOLATILE_CONTEXT_FLAG,
} = require('./contextWindow.service');

// Blank line between retrieved sections, matching what splitVolatileSections in
// contextWindow.service.js splits on. Built from a char code so the two can
// never drift apart through an editing accident.
const SECTION_GAP = String.fromCharCode(10) + String.fromCharCode(10);
const { describeCacheUsage, buildPromptCacheKey } = require('./ai/promptCache.service');

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
 * @param {string}   [opts.clientTimeZone]      — browser IANA zone, advisory
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
 * @param {() => void} [opts.onStreamReset]  — discard text already streamed for
 *   this turn; fired when a round turns out to be a tool call after a preamble
 *   was forwarded, so the client's bubble must be cleared before the next round
 * @param {boolean} [opts.thinkingEnabled]  — user's thinking choice; when
 *   omitted the model's own enabledByDefault applies
 * @param {string|null} [opts.reasoningEffort]   — requested effort level
 * @param {(chunk: string) => void} [opts.onReasoningChunk] — reasoning /
 *   thinking deltas, for models that expose a chain of thought
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
// Set false the first time an insert proves the opt-in `reasoning` column is
// absent, so every later request skips straight to the working shape.
let reasoningColumnExists = true;

/** PostgREST reports an unknown column as PGRST204 naming it in the message. */
const isMissingReasoningColumn = (err) =>
  err?.code === 'PGRST204' || /reasoning/i.test(err?.message || '');

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
    // A prompt can be highly specific without ever using one of these
    // prepositions ("red apple on white background, top-down, photorealistic"),
    // so length stands in as a second signal of a described subject.
    hasEnoughDetails: (text) => /\b(of|for|showing|with)\s+.+/i.test(text)
      || String(text).trim().split(/\s+/).length >= 12,
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

// Multimodal turns carry content as an array of parts rather than a string.
const messageText = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join(' ');
  }
  return '';
};

// Whether the user already filled in a clarification form earlier in this
// conversation. Without this the form is re-armed by the next plain-language
// follow-up that happens to name the artifact again ("generate the image now"),
// so answering it once was not enough to get past it.
const conversationHadClarification = (messages = []) =>
  messages.some((entry) => entry?.role === 'user' && looksLikeClarificationResponse(messageText(entry.content)));

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

// Anonymous chat is no longer reachable — chat.routes.js requires auth on
// both /message and /stream, and tokenCheck.js now 401s if req.user is
// somehow still missing. This constant survives only as the per-request
// ceiling for callers that invoke the pipeline directly (e.g. tests), and as
// a fail-safe should an anonymous entry point ever come back — without it an
// unauthenticated caller could spend without bound.
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
  citations: [],
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
    modelId = 'mistral-medium',
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
    selectedCollectionIds = [],
    history,
    abortController,

    // IANA zone reported by the browser. Advisory only — validated and ranked
    // below the user's saved preference in resolveTimeZone.
    clientTimeZone,

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
    onStreamReset,
    onReasoningChunk,
    onToolStatus,

    // the user's thinking choice for this request
    thinkingEnabled,
    reasoningEffort = null,
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
      // A retired id gets a message naming its replacement instead of a bare
      // "unknown model" — the common case is an old topic whose model was
      // folded into a base model plus an effort level.
      const replacement = RETIRED_MODELS[modelId];
      const message = replacement
        ? `Model "${modelId}" has been retired. Use "${MODELS[replacement]?.label || replacement}" and pick a reasoning effort instead.`
        : `Unknown model: ${modelId}`;
      return makePipelineResult({
        err: new Error(message),
        errorType: 'invalid_model',
        userMessage: message,
        recommendedModelId: replacement || null,
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

    // Anonymous callers have no `per_query_limit` row, so ANONYMOUS_TOKEN_LIMIT stands in as their per-request cap.
    // A per-request cap can only ever lower the ceiling, never raise it past
    // what the model can physically accept.
    const perRequestCap = perQueryLimitEnabled && user?.per_query_limit
      ? user.per_query_limit
      : (isAnonymous ? ANONYMOUS_TOKEN_LIMIT : null);

    // The real ceiling the assembled prompt has to fit under. Everything above
    // this point sizes retrieval; from here on, measurement decides.
    const contextWindow = createContextWindow(
      modelConfig,
      perRequestCap ? { maxPromptTokens: perRequestCap } : {}
    );
    const effectivePerQueryLimit = contextWindow.hardCeiling;

    if (estimatedInputTokens > effectivePerQueryLimit) {
      const userMessage = `Query exceeds maximum allowed tokens. The limit for ${modelConfig.label || modelId} is ${effectivePerQueryLimit.toLocaleString()} tokens, but your query is ~${estimatedInputTokens.toLocaleString()} tokens.`;
      return makePipelineResult({
        err: new Error(userMessage),
        errorType: 'query_too_long',
        userMessage,
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
        // Logged here rather than at the end of the pipeline, which this path
        // returns before ever reaching. Without it a response-cache hit was
        // invisible to analytics and the admin cache-hit-rate tile could only
        // ever read 0%, however well the cache was working.
        await logAnalytics({
          userId: user?.id,
          query: message,
          modelId,
          tokensUsed: totalAITokens,
          isAnonymous,
          cacheHit: true,
          promptCacheReadTokens: 0,
          promptCacheWriteTokens: 0,
          responseTimeMs: Date.now() - startTime,
        });

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
    const embedProvider = embeddingProviderOpt || DEFAULT_PROVIDER;
    let queryVector = null;
    // The model that actually produced queryVector. Every downstream vector
    // search filters on this, so it must come from the embed result rather
    // than from embedProvider — failover can serve a request from a sibling.
    let queryVectorSpace = spaceForProvider(embedProvider);
    let totalEmbeddingTokens = 0;

    if (effectiveRagEnabled) {
      if (abortController.signal.aborted) throw { name: 'AbortError' };
      const embedResult = await embedText(finalQuery, embedProvider, 3, abortController.signal, user?.id);
      if (embedResult) {
        queryVector = embedResult.vector;
        queryVectorSpace = embedResult.space;
        totalEmbeddingTokens += embedResult.tokensUsed;
      }

      // Semantic cache lookup (same embedding vector)
      {
        const semanticCachedReply = await getSemanticCachedResponse(queryVector, modelId, CHAT_SEMANTIC_CACHE_THRESHOLD, user?.id, resolvedTopicId, queryVectorSpace);
        if (semanticCachedReply) {
          // Logged here rather than at the end of the pipeline, which this path
          // returns before ever reaching. Without it a response-cache hit was
          // invisible to analytics and the admin cache-hit-rate tile could only
          // ever read 0%, however well the cache was working.
          await logAnalytics({
            userId: user?.id,
            query: message,
            modelId,
            tokensUsed: totalAITokens,
            isAnonymous,
            cacheHit: true,
            promptCacheReadTokens: 0,
            promptCacheWriteTokens: 0,
            responseTimeMs: Date.now() - startTime,
          });

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
          { tokenBudget: promptBudget.ragTokens, topicId: resolvedTopicId, userId: user?.id, embeddingSpace: queryVectorSpace }
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

    const fileContext = buildFileContext(fileResults, totalFileCount, forceWebSearch);

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
        embeddingSpace: queryVectorSpace,
      });
    }

    // ── 7.6 Knowledge Base Collections (RAG 2.0) ───────────────
    let knowledgeBaseContext = '';
    let citations = [];
    // Hoisted out of the block below: the tool loop needs the same resolved
    // collection set so SEARCH_KB searches exactly what the pre-search did,
    // including any @Collection mentions resolved from the prompt.
    let targetCollectionIds = [];

    if (user?.id) {
      const mentionedNames = extractCollectionMentions(finalQuery);
      targetCollectionIds = Array.isArray(selectedCollectionIds) ? [...selectedCollectionIds] : [];

      if (mentionedNames.length > 0) {
        try {
          const userCollections = await listCollections(user.id);
          for (const name of mentionedNames) {
            const matched = userCollections.find((c) =>
              c.name.toLowerCase() === name.toLowerCase() ||
              c.name.toLowerCase().replace(/[\s_-]+/g, '') === name.toLowerCase().replace(/[\s_-]+/g, '')
            );
            if (matched && !targetCollectionIds.includes(matched.id)) {
              targetCollectionIds.push(matched.id);
            }
          }
        } catch (err) {
          console.warn('[ChatPipeline] Collection mention lookup failed:', err.message);
        }
      }

      if (targetCollectionIds.length > 0) {
        onToolStatus?.({
          type: 'status',
          tool: 'knowledge_search',
          message: 'searching knowledge collections...',
        });

        try {
          const rag2Result = await searchKnowledgeCollections({
            query: finalQuery,
            collectionIds: targetCollectionIds,
            userId: user.id,
            tokenBudget: promptBudget.ragTokens,
            embedProvider,
            signal: abortController.signal,
          });

          // Query rewriter + HyDE + embeddings all cost real provider tokens
          // (see rag2.service.js's `tokensUsed` comment). The tool-triggered
          // SEARCH_KB path already bills this via toolProcessor.service.js's
          // `embedTokens: kbResult.tokensUsed` — without this line, the exact
          // same work done automatically here was free.
          totalEmbeddingTokens += rag2Result.tokensUsed || 0;

          if (rag2Result.context) {
            knowledgeBaseContext = rag2Result.context;
            citations = rag2Result.citations || [];
            if (citations.length > 0) {
              onToolStatus?.({
                type: 'citations',
                citations,
              });
            }
          }

          // ── Corrective retrieval (CRAG) ─────────────────────
          // The cross-encoder relevance gate has already graded these passages
          // on a calibrated scale, so no extra LLM grading call is needed —
          // zero surviving chunks IS the "retrieval was insufficient" signal.
          //
          // What was missing is the corrective half. Previously this state just
          // told the model to ask the user which document to look in, which is
          // a dead end when the answer is simply not in the documents. Now it
          // routes to the tools that can actually recover: a re-query with
          // different terms, or the open web when the topic is out of scope.
          if (rag2Result.chunkCount === 0) {
            const recoveryOptions = [
              'Re-run [SEARCH_KB:query="..."] with different wording — the first attempt used the original phrasing verbatim, and these documents may name the concept differently.',
              ...(forceWebSearch
                ? ['If the topic is genuinely outside these documents, use [WEB_SEARCH:query="..."] instead.']
                : ['If the topic is genuinely outside these documents, say so plainly and answer from your own knowledge, making clear it is not from the attached sources.']),
              'Do not claim the knowledge base is empty or missing — it is attached and listed above.',
            ];
            knowledgeBaseContext += `\n\n## RETRIEVAL WAS INSUFFICIENT\nNo passage cleared the relevance bar for this query. Before answering:\n${recoveryOptions.map((line, i) => `${i + 1}. ${line}`).join('\n')}`;
            console.log('[ChatPipeline] KB retrieval returned nothing relevant; corrective directive injected.');
          }
        } catch (rag2Err) {
          console.warn('[ChatPipeline] Knowledge collection search error:', rag2Err.message);
        }
      }
    }

    // ── 8. Build AI messages ──────────────────────────────────
    const aiMessages = [];
    const askClarifyingDirective = `\n\n## IMPORTANT: Ask Clarifying Questions First\nBefore using any GENERATE_* tool (GENERATE_PPT, GENERATE_IMAGE, GENERATE_HTML, GENERATE_PDF, GENERATE_EXCEL, GENERATE_DOCX, GENERATE_CHART, GENERATE_CSV):\n- If the user's request lacks critical details (title, theme, structure, layout, purpose, content), ask clarifying questions FIRST\n- Do NOT immediately jump to generation with vague or insufficient information\n- Ask 2-4 specific, targeted questions to get the details you need\n- Only use the GENERATE_* tool AFTER the user has provided sufficient context\n- This ensures the output matches what the user actually wants\n- Wait for the user's response before proceeding with generation`;
    // Only advertised when a knowledge base is actually attached — offering a
    // tool that cannot return anything just invites wasted rounds.
    const kbToolLines = targetCollectionIds.length > 0
      ? [
        '0. Search Knowledge Base: [SEARCH_KB:query="your search query"]',
        '   - An automatic search on the original wording already ran; its results are above',
        '   - Use this to search AGAIN with better terms once you know what you are looking for,',
        '     or to look up a second topic the first search did not cover',
        '   - Prefer it over web search for anything the attached documents would cover',
        '   - Do not repeat a query that already returned nothing; rephrase or say it is not covered',
      ]
      : [];

    const toolLines = [
      ...kbToolLines,
      ...(forceWebSearch ? ['1. Web Search: [WEB_SEARCH:query="your search query"] — Use for real-time web info or researching unknown database/system error codes, panics, and outage bugs from uploaded logs.'] : []),
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

    // The system prompt is emitted as ONE stable block, and everything that
    // changes between turns is pushed to the end of the prompt instead.
    //
    // Temporal grounding used to sit here as a second system block. It carries a
    // live clock quantised to TEMPORAL_PRECISION_MS (60s by default), so it is
    // byte-identical only for turns less than a minute apart — and a provider
    // prompt cache keys on an exact prefix. Sitting ahead of the history, it
    // broke the prefix there on essentially every real conversation, capping the
    // cacheable region at this static block (~959 tokens) no matter how long the
    // thread grew. Moving it in with the retrieved context leaves system +
    // history byte-identical across turns, which is the whole point of the
    // ordering. (It also cannot be fixed by placing it later as a system
    // message: Claude hoists every system message into its top-level `system`
    // field regardless of array position, so only leaving the system role works.)
    aiMessages.push({ role: 'system', content: staticSystem });

    const { timeZone } = resolveTimeZone({
      requestTimeZone: clientTimeZone,
      userTimeZone: user?.timezone,
    });
    const temporalBlock = renderTemporalSystemBlock(buildTemporalContext({ timeZone }));


    const volatileSections = [];
    // Temporal grounding leads the volatile block: it is authoritative, small
    // (~256 tokens), and belongs next to the question it dates. It carries no
    // "## " heading of its own, so sectionPriority ranks it last for eviction —
    // it is only ever dropped if the whole block goes.
    volatileSections.push(temporalBlock);
    if (ragContext) volatileSections.push(`## Retrieved Context\n${ragContext}`);
    if (forcedWebContext) volatileSections.push(`## Web Search Context\n${forcedWebContext}`);
    if (urlContext) volatileSections.push(`## URL Context\n${urlContext}`);
    if (fileContext) volatileSections.push(`## File Context\n${fileContext}`);
    if (memoryContext) volatileSections.push(memoryContext);
    if (knowledgeBaseContext) volatileSections.push(knowledgeBaseContext);
    // Retrieved context is NOT emitted as a system block. It changes on every
    // turn, and a provider's prompt cache keys on an exact prefix: anything
    // volatile placed ahead of the history breaks the prefix there, so the
    // whole conversation is re-read at full price every request. Sitting it
    // beside the question instead leaves system + history byte-identical turn
    // to turn, which took the cacheable prefix from ~1k tokens to ~85k on a
    // long thread. It also reads better: models attend worst to the middle of
    // a long context, and this moves retrieved passages to the end, next to
    // the question they answer.
    const pinnedSystemCount = aiMessages.length;

    // History. The `history` fallback is client-supplied (anonymous sessions have
    // no server-side topic), so it is untrusted: cap the number of turns, coerce
    // each entry to a known shape, and trim it to the history token budget. An
    // uncapped array here let a caller push megabytes straight into the prompt.
    if (historyContext && historyContext.length > 0) {
      aiMessages.push(...historyContext);
    } else if (Array.isArray(history) && history.length > 0) {
      aiMessages.push(...sanitizeClientHistory(history, promptBudget.historyTokens));
    }

    // Deliberately NOT pre-trimmed. A pasted log or stack trace is usually the
    // whole point of the turn, and cutting it to a fixed percentage before
    // knowing what the rest of the prompt weighs threw away context that had
    // room. If the assembled prompt really does overflow, fitPromptToWindow
    // trims the query as its last resort, after everything cheaper is gone.
    // The retrieved context rides in as its own flagged message so the window
    // fitter can still drop whole sections from it by priority. It is merged
    // into the user turn immediately after fitting, so the provider sees one
    // message and role alternation stays intact.
    if (volatileSections.length > 0) {
      aiMessages.push({
        role: 'user',
        content: volatileSections.join(SECTION_GAP),
        [VOLATILE_CONTEXT_FLAG]: true,
      });
    }

    // Deliberately NOT pre-trimmed. A pasted log or stack trace is usually the
    // whole point of the turn, and cutting it to a fixed percentage before
    // knowing what the rest of the prompt weighs threw away context that had
    // room. If the assembled prompt really does overflow, fitPromptToWindow
    // trims the query as its last resort, after everything cheaper is gone.
    const userContent = image
      ? [
          { type: 'text', text: finalQuery || 'Analyze this image' },
          { type: 'image_url', image_url: { url: image } },
        ]
      : finalQuery;
    aiMessages.push({ role: 'user', content: userContent });

    const artifactIntent = !image ? detectArtifactIntent(finalQuery) : null;
    // aiMessages ends with the turn being processed; the clarification history
    // that matters is everything before it.
    const alreadyClarified = looksLikeClarificationResponse(finalQuery)
      || conversationHadClarification(aiMessages.slice(0, -1));
    if (artifactIntent && !alreadyClarified && !artifactIntent.hasEnoughDetails(finalQuery)) {
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

    // ── 8b. Fit the assembled prompt to the model's window ────
    // Everything above assembled raw. Measure it now and evict only if it
    // genuinely does not fit — which on a 128K-256K model is the exception, not
    // the rule. When it fits, aiMessages is returned untouched so the prompt
    // prefix is byte-identical to last turn and the provider's cache still hits.
    const fit = fitPromptToWindow({
      messages: aiMessages,
      window: contextWindow,
      pinnedSystemCount,
    });
    // Fold the retrieved-context block into the user turn now that eviction has
    // decided what survives, so the provider sees one message and role
    // alternation holds.
    const fittedMessages = mergeVolatileIntoQuery(fit.messages);
    const promptTokens = fit.report.tokensAfter;

    if (fit.report.evicted) {
      console.warn(`[ChatPipeline] Context eviction: ${describeFitReport(fit.report)}`);
    } else {
      console.log(`[ChatPipeline] Context: ${describeFitReport(fit.report)}`);
    }

    // Only when eviction has spent every lever it has — all droppable history
    // gone, retrieved context gone, query trimmed to its floor — is the turn
    // genuinely impossible. Before this change any overflow landed here.
    if (fit.report.overflow) {
      const userMessage = `This message is too large for ${modelConfig.label || modelId} even after trimming older context. The limit is ${contextWindow.hardCeiling.toLocaleString()} tokens; this request needs ~${promptTokens.toLocaleString()}. Try a model with a larger context window, or send less text at once.`;
      return makePipelineResult({
        err: new Error(userMessage),
        errorType: 'context_too_large',
        userMessage,
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
      forceWebSearch: Boolean(forceWebSearch),
      // Lets the model re-query the knowledge base mid-answer via SEARCH_KB,
      // instead of being limited to the single automatic pre-search above.
      collectionIds: targetCollectionIds,
      embedProvider,
      ragTokenBudget: promptBudget.ragTokens,
      // Citations discovered by a tool call have to reach the same array the
      // pre-search populates, or the UI shows sources for only the first pass.
      onCitations: (toolCitations) => {
        const seen = new Set(citations.map((c) => `${c.documentId}:${c.snippet}`));
        for (const c of toolCitations) {
          const key = `${c.documentId}:${c.snippet}`;
          if (seen.has(key)) continue;
          seen.add(key);
          citations.push({ ...c, citationId: citations.length + 1 });
        }
      },
    };
    if (onToolStatus) {
      processToolCallArgs.onStatus = onToolStatus;
    }

    const loopResult = await runToolLoop({
      effectiveModelConfig,
      // The fitted array, not the raw one — the loop appends to whatever it is
      // given, so handing it the pre-eviction messages would put the evicted
      // context straight back into the prompt.
      aiMessages: fittedMessages,
      abortController,
      processToolCallArgs,
      promptBudget,
      // Tool rounds are budgeted against what the base prompt actually left,
      // not a flat share of the window.
      contextWindow,
      // Keyed per conversation: every turn of one chat shares a prefix and
      // should land on the same provider backend.
      promptCacheKey: buildPromptCacheKey(resolvedTopicId, user?.id),
      maxToolRounds: MAX_TOOL_ROUNDS,
      deadlineAt: startTime + CHAT_TIME_BUDGET_MS,
      loggerPrefix: 'ChatPipeline',
      onStreamChunk,
      onStreamReset,
      onReasoningChunk,
      reasoningRequest: { thinkingEnabled, reasoningEffort },
    });

    if (loopResult.aborted) throw { name: 'AbortError' };

    console.log(
      `[ChatPipeline] Tool loop done in ${Date.now() - startTime}ms ` +
      `(rounds=${loopResult.roundsUsed}/${MAX_TOOL_ROUNDS}, budget=${CHAT_TIME_BUDGET_MS}ms, timedOut=${loopResult.timedOut})`
    );

    finalReply = loopResult.finalReply;
    totalAITokens += loopResult.totalAITokens || 0;
    totalEmbeddingTokens += loopResult.totalEmbeddingTokens || 0;
    const cacheCreationTokens = loopResult.cacheCreationTokens || 0;
    const cacheReadTokens = loopResult.cacheReadTokens || 0;
    // Prompt caching is invisible unless it is reported. Most providers here
    // cache automatically, so this line is the only way to tell a working cache
    // from one that silently stopped hitting because the prefix started moving.
    console.log(`[ChatPipeline] ${modelConfig.label || modelId} ${describeCacheUsage({ cacheCreationTokens, cacheReadTokens }, promptTokens)}`);
    const generatedMediaFiles = loopResult.generatedMedia || [];
    const reasoningText = loopResult.reasoningText || '';

    // Strip leftover tool-call syntax
    finalReply = stripToolTags(finalReply);

    // The loop stopped on the time budget. If it broke right after a tool ran,
    // the last reply was a tool call and strips to nothing — so fall back to a
    // plain notice rather than persisting an empty assistant message.
    if (loopResult.timedOut) {
      const notice = 'I ran out of time before finishing this response. Please try again, or narrow the question so it needs fewer steps.';
      const partialReply = finalReply.trim();
      finalReply = partialReply ? `${partialReply}\n\n_${notice}_` : notice;

      // The client builds the bubble purely from streamed chunks — `done`
      // carries no text (chat.routes.js) — so a turn that streamed nothing
      // renders empty. Today the budget check can only break right after a tool
      // round cleared the buffer, so that is the live case; keying off
      // streamedToClient rather than that invariant keeps this correct if the
      // loop ever streams before continuing (e.g. via onNoToolCall), where
      // re-sending the whole reply would duplicate text already on screen.
      if (onStreamChunk) {
        onStreamChunk(loopResult.streamedToClient ? `\n\n_${notice}_` : finalReply);
      }
    }

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
      await setCachedResponse(finalQuery, modelId, finalReply, queryVector, user?.id, resolvedTopicId, queryVectorSpace);
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
        const buildRows = (withReasoning) => [
          { topic_id: resolvedTopicId, user_id: user.id, role: 'user', content: message, model: modelId, tokens_used: estimatedInputTokens },
          {
            topic_id: resolvedTopicId, user_id: user.id, role: 'assistant', content: finalReply,
            model: modelId, tokens_used: billableTokens, generated_files: generatedFilesValue,
            ...(withReasoning && reasoningText ? { reasoning: reasoningText } : {}),
          },
        ];

        // `reasoning` ships as an opt-in migration
        // (database/migration_add_reasoning_to_messages.sql). Until it is
        // applied the column does not exist and PostgREST rejects the whole
        // insert, which would take the chat down rather than just lose the
        // thought process — so fall back once and remember for this process.
        let { data: savedMessages, error: msgError } = await supabase
          .from('messages').insert(buildRows(reasoningColumnExists)).select('id, role');

        if (msgError && reasoningColumnExists && isMissingReasoningColumn(msgError)) {
          console.warn('[ChatPipeline] messages.reasoning column not found — run database/migration_add_reasoning_to_messages.sql to persist reasoning. Saving without it.');
          reasoningColumnExists = false;
          ({ data: savedMessages, error: msgError } = await supabase
            .from('messages').insert(buildRows(false)).select('id, role'));
        }

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
    // This can only run after the assistant row exists (it embeds
    // `savedAssistantMessageId`), which is after step 11 persisted that row
    // with `billableTokens` computed at step 9 — before this cost was known.
    // So: persist first with the pre-memory total, then once the
    // memory-embedding cost is known, patch the persisted row and use the
    // corrected total for everything downstream (DB increment, analytics,
    // the log line, and the returned/streamed result), so all four agree.
    let finalBillableTokens = billableTokens;
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
          finalBillableTokens = billableTokens + memoryEmbedTokens;
          console.log(`[Memory] Embedding tokens: ${memoryEmbedTokens}`);

          // The assistant row was already persisted (step 11) with the
          // pre-memory total — patch it so tokens_used matches what actually
          // gets billed below, instead of silently under-reporting it forever.
          if (savedAssistantMessageId) {
            const { error: patchErr } = await supabase
              .from('messages')
              .update({ tokens_used: finalBillableTokens })
              .eq('id', savedAssistantMessageId);
            if (patchErr) {
              console.warn('[ChatPipeline] Failed to patch assistant message tokens_used after memory embedding:', patchErr.message);
            }
          }
        }
      }
    }

    // ── 13. Update user token usage ───────────────────────────
    if (user) {
      console.log(`[TokenTracking] AI=${totalAITokens} Embedding=${totalEmbeddingTokens} InputMsg=${estimatedInputTokens} Total=${finalBillableTokens}`);
      await supabase.rpc('increment_user_tokens', { user_id: user.id, token_amount: finalBillableTokens });
    }

    // ── 14. Log analytics ─────────────────────────────────────
    await logAnalytics({
      userId: user?.id,
      query: message,
      modelId,
      tokensUsed: finalBillableTokens,
      isAnonymous,
      // Reaching here means the model was actually called, so this is never a
      // response-cache hit. Those are logged at their own early returns above.
      cacheHit: false,
      promptCacheReadTokens: cacheReadTokens,
      promptCacheWriteTokens: cacheCreationTokens,
      responseTimeMs: Date.now() - startTime,
    });

    // ── Return ────────────────────────────────────────────────
    return makePipelineResult({
      finalReply,
      billableTokens: finalBillableTokens,
      totalAITokens,
      totalEmbeddingTokens,
      orchestratorBrain,
      queryCacheHit: false,
      cacheCreationTokens,
      cacheReadTokens,
      // `cacheHit` is what the UI labels "(Cached)" and what the admin
      // cache-hit-rate tile counts, so it has to keep meaning "this reply was
      // served from our cache without calling the model". It is deliberately
      // NOT `cacheReadTokens > 0`: that is the provider's prompt cache, which
      // reuses the prompt prefix while still generating a fresh answer. Once the
      // adapters started reporting prompt-cache reads correctly, the old
      // definition would have stamped "(Cached)" on nearly every DeepSeek reply
      // and pushed the admin tile to ~100%. Prompt-cache volume is reported
      // separately, in cacheReadTokens/cacheCreationTokens.
      cacheHit: false,
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
      citations,
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
