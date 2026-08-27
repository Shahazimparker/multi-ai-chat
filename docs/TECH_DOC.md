# Multi-AI Chat Technical Documentation

This document is the technical reference for the current codebase state.

## Architecture & Cloud Infrastructure

- **Frontend**: React app in `frontend/` deployed on **Vercel (Free / Hobby Tier)** in region **Mumbai (`bom1`)**
- **Backend**: Node.js/Express Serverless API in `backend/` deployed on **Vercel (Free / Hobby Tier)** in region **Mumbai (`bom1`)** with `maxDuration: 300`
- **File Storage**: **Private Vercel Blob** (`multi-chat-upload-storage`) in **Mumbai (`bom1`)** supporting direct client-to-blob streaming up to **50MB** (`@vercel/blob/client`)
- **Database**: Supabase PostgreSQL + `pgvector` hosted in **Singapore (`ap-southeast-1`)** on **Free Tier (500MB DB Limit)** using lean `blob_url` pointer storage
- **Deployment Config**: `frontend/vercel.json`, `backend/vercel.json` (configured for `"regions": ["bom1"]`)
- **Agent Rules**: [AGENTS.md](../AGENTS.md)

---

## Backend Overview

### Entry and Middleware

- Entry point: `backend/server.js`
- Security/logging: `helmet`, `cors`, `morgan`, `express-rate-limit`
- Request parsing: JSON body (`10mb`)
- Global middleware: Sentry handlers, CSRF protection, token cleanup jobs
- `app.set('trust proxy', 1)` — required by Vercel for `express-rate-limit` to read real IPs
- Main routes:
  - `/api/auth`
  - `/api/chat`
  - `/api/admin`
  - `/api/approval`
  - `/api/history`
  - `/api/upload`
  - `/api/knowledge`
  - `/api/health`

### Core Route Modules

- `backend/routes/auth.routes.js`
- `backend/routes/chat.routes.js`
- `backend/routes/admin.routes.js`
- `backend/routes/approval.routes.js`
- `backend/routes/history.routes.js`
- `backend/routes/upload.routes.js`
- `backend/routes/knowledge.routes.js` — **New**: Knowledge Base & RAG 2.0

### Controllers

- `backend/controllers/auth.controller.js`
- `backend/controllers/chat.controller.js`
- `backend/controllers/admin.controller.js`
- `backend/controllers/history.controller.js`
- `backend/controllers/approval.controller.js` — **New**: owns `respondFromChat`, `checkApprovalStatus`, `listPendingApprovals`, `approveRequest`, `rejectRequest`

### Streaming Architecture

- `backend/services/chatPipeline.service.js` — Single shared pipeline behind `/stream` and legacy `/message`. Full sequence: model validation → query compress → cache check → embedding + RAG/KB → temporal context → history → system prompt → tool loop → persistence → analytics.
- **Real provider streaming**: Each AI provider service has a `callXxxStream()` variant using the SDK's native `stream: true`. Text deltas are forwarded via `onChunk` callback as they arrive. No artificial delays.
- `dispatchToAIStream()` in `backend/services/ai/dispatcher.service.js` routes to the correct provider.
- `runToolLoop()` in `backend/services/toolLoop.service.js` accepts `onStreamChunk` + `onStatusEvent`. Tool rounds buffer chunks internally; only the final round (no tool calls) forwards chunks to the client. Respects `CHAT_TIME_BUDGET_MS` — stops starting a new round once the wall-clock budget is exceeded.
- `backend/services/orchestratorBrain.service.js` is an optional pre-stream planning layer (off by default, `ENABLE_ORCHESTRATOR_BRAIN=false`). Its tokens are counted into `totalAITokens` when enabled.
- Human approvals persist in Supabase via `human_approvals`; API approval/rejection through `/api/approval` without blocking serverless invocations.
- Providers with streaming support: OpenAI, Groq, Claude, Gemini, Mistral, Cohere, DeepSeek, OpenRouter, Together, AnyAPI — all 10 providers.

### Pipeline Feature Flags

`CANONICAL_CHAT_PIPELINE_FLAGS` (frozen object in `chatPipeline.service.js`):

| Flag | Default | Meaning |
|---|---|---|
| `exactCacheEnabled` | `false` | Exact SHA-256 cache lookup disabled for live chat |
| `identityCheckEnabled` | `true` | Identity/persona questions short-circuit before AI dispatch |
| `perQueryLimitEnabled` | `true` | Per-query token limit enforced from `users.per_query_limit` |
| `dynamicBudgetEnabled` | `true` | Token budget allocated dynamically based on query complexity |
| `memoryEnabled` | `true` | Cross-chat RAG memory active |
| `cacheResponse` | `true` | Successful responses written to semantic cache |
| `postSaveEmbedding` | `true` | Message embedded into `message_embeddings` after DB save |
| `enableOrchestratorBrain` | `false` | Custom AI framework runtime. Off by default. |

### Runtime Config (`backend/config/chatRuntime.config.js`)

All values are read from env at startup with clamped parsing:

| Variable | Default | Range | Purpose |
|---|---|---|---|
| `ENABLE_ORCHESTRATOR_BRAIN` | `false` | bool | Pre-stream planning layer |
| `CHAT_TIME_BUDGET_MS` | `240000` | 10000–3600000 | Wall-clock cap for the tool loop |
| `AI_CALL_TIMEOUT_MS` | `120000` | 0–600000 | Single provider call timeout |
| `CHAT_MAX_DB_QUERIES` | `12` | 1–100 | Max tool-call rounds per request |
| `CHAT_MAX_CONSECUTIVE_ZERO_RESULTS` | `4` | 1–20 | Bail-out after N empty tool results |
| `CHAT_TOOL_RESERVE_RATIO` | `0.15` | 0.05–0.6 | Fraction of token budget for tools |
| `CHAT_SEMANTIC_CACHE_THRESHOLD` | `0.92` | 0–1 | Cosine similarity for semantic cache hit |
| `RAG_RERANK_ENABLED` | `true` | bool | Cohere cross-encoder reranking |
| `RAG_RERANK_MODEL` | `rerank-v3.5` | — | Cohere model id |
| `RAG_RERANK_TIMEOUT_MS` | `8000` | 1000–30000 | Per-rerank call timeout |
| `RAG_RERANK_CANDIDATE_MULTIPLIER` | `5` | 2–20 | pgvector candidate count multiplier |
| `RAG_RERANK_MIN_RELEVANCE` | `0.30` | 0–1 | Min Cohere score to cite a passage |
| `RAG_QUERY_EXPANSION_ENABLED` | `true` | bool | Multi-query expansion |
| `RAG_QUERY_EXPANSION_COUNT` | `3` | 1–6 | Alternate phrasings per query |
| `RAG_HYDE_ENABLED` | `false` | bool | HyDE hypothetical-answer embedding |
| `RAPTOR_SUMMARY_PENALTY` | `0.05` | 0–0.5 | Score penalty for summary nodes |
| `GRAPHRAG_ENABLED` | `true` | bool | Entity/relation graph retrieval |
| `GRAPHRAG_MAX_HOPS` | `1` | 0–3 | Graph traversal depth |
| `DEFAULT_TIMEZONE` | `UTC` | IANA | Default timezone for temporal context |
| `TEMPORAL_PRECISION_MS` | `60000` | 1000–3600000 | "Now" rendering granularity |
| `HISTORY_WINDOW_STEP` | `10` | 1–100 | How far the raw-history window anchor advances at a time. 1 restores the old per-turn sliding, which broke the prompt cache every turn past the window |
| `ANTHROPIC_CACHE_TTL` | `1h` | `5m` / `1h` | Anthropic cache lifetime. 1h costs a higher write rate but only on the per-turn delta |
| `OPENAI_PROMPT_CACHE_RETENTION` | *(unset)* | `in_memory` / `30m` / `24h` | Omitted unless set — accepted values are model-dependent and a wrong one is a rejected request |
| `CONTEXT_RESERVED_OUTPUT_TOKENS` | `0` (auto) | 0–64000 | Tokens held back for the reply. 0 derives it: flat 8,192 at/above a 32K window, 25% below |
| `CONTEXT_SAFETY_MARGIN_RATIO` | `0.06` | 0.01–0.30 | Headroom below the usable window absorbing token-estimate drift |
| `CONTEXT_EVICTION_TARGET_RATIO` | `0.85` | 0.50–0.99 | Low-water mark eviction targets, so the prefix stays stable across turns |
| `CONTEXT_MIN_RECENT_MESSAGES` | `4` | 2–40 | History messages eviction will never drop |
| `CONTEXT_MIN_QUERY_TOKENS` | `512` | 64–32000 | Floor below which the turn is refused rather than the question cut to a stub |
| `COHERE_RERANK_RPM` | `10` | >=1 | Local rolling-window rerank budget, so bursts throttle before hitting a 429 |

### Core Services

**Chat & Routing:**
- `chatPipeline.service.js` — shared streaming + JSON pipeline
- `chatCleanup.service.js` — `stripToolTags`, `isPlaceholderOnly`, `classifyError`
- `toolLoop.service.js` — the actual running loop (time-budgeted)
- `toolProcessor.service.js` — detects and dispatches individual tool tags
- `compress.service.js` — filler-phrase compression for prompts

**Context & Memory:**
- `context.service.js`, `summary.service.js` — per-topic history and summarization
- `memory.service.js` — 6 in-process strategies + `embedAndStoreMessage` / `searchMemory` for cross-chat RAG memory
  - Hybrid reranking weights: **55% cosine + 30% BM25 + 15% Jaccard**, +0.1 numeric boost via RRF
  - Thresholds: `RAG_HYBRID_THRESHOLD = 0.52`, `MEMORY_HYBRID_THRESHOLD = 0.56`
  - Memory context capped at 600 tokens split across results via `trimTextByTokens`

**RAG & Embeddings:**
- `rag.service.js` — Cohere cross-encoder reranking (`rerank-v3.5`) with 429 rate limit resilience and fallback to hybrid reranking (cosine+BM25+Jaccard+RRF) for chat-upload context
- `fileUpload.service.js` — interactive file/log search (`searchUserFilesRAG`) with Cohere cross-encoder reranking and non-blocking 429 cooldown fallback
- `rag2.service.js` — **New**: RAG 2.0 engine for Knowledge Base collections
  - Parent-child chunking, multi-query expansion, HyDE, cross-encoder reranking, RAPTOR summary nodes, GraphRAG fusion
  - `ingestDocumentContent` — indexes a document into a collection
  - `searchKnowledgeCollections` — fuses dense + sparse + graph passes with Cohere reranking
- `retriever.service.js` — 6 retrieval strategies (Vector, BM25, Hybrid, Metadata, Reranker, Chained)

**Knowledge Base (RAG 2.0) — All New:**
- `knowledgeCollection.service.js` — CRUD for knowledge collections and documents
- `knowledgeCrawler.service.js` — website crawler for ingesting web pages into collections (depth-limited BFS, HTML→text, SSRF guard)
- `knowledgeGraph.service.js` — LLM-based entity/relation extraction (GraphRAG); builds `knowledge_entities` and `knowledge_relations` tables per collection
- `raptor.service.js` — RAPTOR hierarchical summarization tree (k-means clustering + LLM summarization); adds summary nodes at multiple abstraction levels for broad-question retrieval
- `queryTransform.service.js` — **New**: multi-query expansion (`expandQuery`) and HyDE (`generateHypotheticalAnswer`) with provider fallback chain

**Document Processing:**
- `documentLoader.service.js` — loads 40+ file formats with text extraction
- `textSplitter.service.js` — 4 intelligent chunking strategies
- `visionExtraction.service.js` — **New**: LLM-based image→text extraction at ingest (free-first ordering: Mistral Small → Gemini Flash-Lite; rate-limit cooldown per provider)
- `pdfOcr.service.js` — **New**: PDF OCR fallback (Mistral OCR → OpenRouter chat model) when `pdf-parse` text layer is too thin

**Temporal Context — New:**
- `temporalContext.service.js` — builds a deterministic date/time/week block injected into every system prompt so the model answers from live time rather than training data
  - `resolveTimeZone()` — priority: user-saved DB preference → browser IANA zone → `APP_DEFAULT_TIMEZONE`
  - `buildTemporalSystemBlock()` — renders ISO date, week, time, quarter as a compact system block

**Infrastructure:**
- `cache.service.js` — semantic cache (pgvector cosine ≥ threshold); exact cache disabled for live chat
- `tokenBudget.service.js` — `estimateTokens`, `fitMessagesToBudget`, `createDynamicPromptBudget`, `smartTrimContextBlock`. Budgets here size **retrieval** and always sum to <= 100%; they are not the window guard. `estimateTokens` takes `max(char, word)`, is density-aware (3 chars/token for structured text, 4 for prose) and counts multimodal image parts
- `context.service.js` — history assembly. The raw window is anchored to its **oldest** kept message and advances only in `HISTORY_WINDOW_STEP` jumps: anchoring to the newest message slid it every turn, changing the first history message on every request and invalidating the provider cache for any thread past the window. Returns `olderSummary` separately so the caller can place it after the raw turns rather than ahead of them (it is regenerated ~every 12 messages, and at the head it invalidated everything behind it)
- `contextWindow.service.js` — **New**: the window guard. `createContextWindow` derives the hard ceiling (window − reserved output − safety margin) and a low-water mark; `fitPromptToWindow` measures the assembled prompt and returns it **untouched** when it fits, otherwise evicts in order (disposable context → oldest whole history turns → remaining context → query) down to the low-water mark; `mergeVolatileIntoQuery` folds the retrieved-context block into the user turn; `toolLoopHeadroom` budgets tool rounds against what the base prompt left
- `tokenAccounting.service.js` — prefers provider-reported token counts over local estimates
- `analytics.service.js` — `logAnalytics` per request. Records `cache_hit` (**response** cache: reply served without calling a model) separately from `prompt_cache_read_tokens` / `prompt_cache_write_tokens` (**provider prefix** cache). Degrades to the legacy insert shape if `migration_add_prompt_cache_analytics.sql` has not been applied, so code-before-schema loses detail rather than dropping rows
- `fileUpload.service.js` — file ingestion, embedding, ZIP safety limits, hybrid grep/vector search, and private Blob fallback
- `toolProcessor.service.js` — **New**: tool execution dispatcher, SRE diagnostic log digest scanner (Logdy/OpenObserve sliding-window clustering), SAP ST22 short dump sectional parser, and dynamic web error cross-referencing loop (`[WEB_SEARCH]` ➔ `[SEARCH_FILES]`)
- `blobStorage.service.js` — **New**: wrapper for `@vercel/blob` (`get`, `del`, `head`, `setBlobClient`, `fetchPrivateBlobBuffer`, `deleteBlobFromStorage`)
- `approvalManager.shared.js` — single `ApprovalManager` instance shared across controllers/services
- `rateLimitStore.service.js` — **New**: Supabase-backed rate-limit store for `express-rate-limit` (serverless-safe; each `createRateLimitStore()` call returns a fresh instance to satisfy `express-rate-limit`'s store-reuse validator)
- `humanApproval.service.js` — approval checkpoints; timeout clamped to 1-hour hard cap; process-wide WeakRef sweeper replaces per-instance `setInterval` to prevent memory leaks

**AI Framework (optional/advanced):**
- `agent.service.js`, `agentOrchestrator.service.js` — ReAct agents, SmartAgent
- `chain.service.js`, `graphWorkflow.service.js` — chains and DAG workflows
- `callbacks.service.js` — lifecycle hooks; auto-registers Logger, CostTracker, MetricsCollector
- `executionTracer.service.js` — step tracing with TTL+LRU eviction (100 trace cap, 1hr TTL)
- `flowVisibility.service.js` — variable tracking, state diffing, flow analysis
- `outputParser.service.js`, `promptTemplate.service.js`, `vectorStore.service.js` — LangChain equivalents

**File Generation:**
- `imageGeneration.service.js` (Recraft/FLUX via OpenRouter)
- `pptGeneration.service.js` (pptxgenjs — 15 layouts, 20 themes)
- `pdfGeneration.service.js` (pdfkit)
- `excelGeneration.service.js` (exceljs)
- `wordGeneration.service.js` (docx)
- `csvGeneration.service.js`
- `chartGeneration.service.js` (SVG)
- `htmlGeneration.service.js`, `jsonGeneration.service.js`, `markdownGeneration.service.js`

### AI Provider Layer

- Dispatcher: `backend/services/ai/dispatcher.service.js` — wraps all providers with `AI_CALL_TIMEOUT_MS` deadline. Both `dispatchToAI` and `dispatchToAIStream` accept an `options` object carrying `promptCacheKey`
- Prompt cache: `backend/services/ai/promptCache.service.js` — **New**. `extractCacheUsage` normalises the four provider dialects (Anthropic `cache_creation_input_tokens`/`cache_read_input_tokens`; OpenAI/Mistral/Groq `prompt_tokens_details.cached_tokens`; DeepSeek `prompt_cache_hit_tokens`; Gemini `cachedContentTokenCount`) — reading the wrong one fails **silently**, so every adapter goes through it. `buildPromptCacheKey` keys per conversation. `applyAnthropicHistoryBreakpoint` places Claude's `cache_control` at the end of the history, checking the 1,024-token floor first (a sub-minimum breakpoint is accepted and then ignored, while still billing a 1.25x write)
  - **Mistral does not cache at all without `prompt_cache_key`** — it is the default model, so this parameter is the difference between caching working and not existing. Verified live: 0 cached tokens without, 1,152 with
  - Caches are per-provider: switching model mid-conversation costs exactly one cold turn, then re-warms
  - **Nothing conditional may enter `staticSystem`** — it is the cached prefix. The temporal clock, the per-message tool advertisements (`SEARCH_KB` / `WEB_SEARCH`) and the identity directive all travel in the volatile block for this reason; each varies per message and would otherwise invalidate the history cache on every change. `staticSystem` now derives only from `runtimeIdentity` + `generalToolsDirective`.
  - **Only `staticSystem` is a system block.** Temporal grounding moved into the volatile block beside the question: its clock is quantised to `TEMPORAL_PRECISION_MS` (60s), so as a system block it broke the cacheable prefix for any two turns more than a minute apart — capping the cached region at ~640 tokens however long the thread grew. Live DeepSeek A/B with spaced turns: 640 (old) vs 2,176 (new) cached tokens per turn. Moving it later as a *system message* would not help, because Claude hoists all system messages into its top-level `system` field
- `reasoning.service.js` — **New**: `resolveReasoning()` maps effort level (low/medium/high/max/xhigh) to the correct per-provider parameter; `supportsReasoning()` gates the Thinking UI toggle per model
- Provider modules: `gemini`, `groq`, `mistral`, `deepseek`, `claude`, `openrouter`, `openai`, `cohere`, `together`, `anyapi`, `unified`

### Model Configuration

- Source of truth: `backend/config/models.js`
- **Current registry: 17 entries (16 fixed models + the `openrouter` live-list entry) + 2 additional live-catalog providers (`together`, `anyapi`)**

| Key | Label | Provider | Free |
|---|---|---|---|
| `deepseek-v4-flash` | DeepSeek V4 Flash | deepseek | No |
| `deepseek-v4-pro` | DeepSeek V4 Pro | deepseek | No |
| `groq-gpt-oss-20b` | Groq GPT-OSS 20B | groq | Yes |
| `groq-gpt-oss-120b` | Groq GPT-OSS 120B | groq | Yes |
| `groq-qwen3` | Groq Qwen3.6 27B | groq | Yes |
| `gemini-flash` | Gemini Flash 3.7 | gemini | Yes |
| `gemini-flash-lite` | Gemini Flash-Lite 3.5 | gemini | Yes |
| `gemini-pro` | Gemini Pro 3.1 Preview | gemini | No |
| `ministral-14b` | Ministral 14B | mistral | Yes |
| `codestral-2508` | Codestral 2508 | mistral | Yes |
| `mistral-small` | Mistral Small 4 | mistral | Yes |
| `mistral-medium` | Mistral Medium 2508 (Default) | mistral | Yes |
| `mistral-large` | Mistral Large | mistral | Yes |
| `claude-haiku` | Claude Haiku 4.5 | claude | No |
| `claude-sonnet-5` | Claude Sonnet 5 | claude | No |
| `claude-opus-4-8` | Claude Opus 4.8 | claude | No |
| `openrouter` | OpenRouter (live list) | openrouter | No |

- `SUMMARY_MODEL = MODELS['gemini-flash']` (used for history summarization)
- `RETIRED_MODELS` map: old model ids → replacement id (stored topics fail rather than silently re-routing)
- **Reasoning support per model**: DeepSeek (high/max only), Groq GPT-OSS + Qwen3 (low/medium/high), Gemini Flash-Lite (minimal/low/medium/high), Gemini Flash/Pro (low/medium/high), Claude Haiku (extended thinking on/off), Claude Sonnet 5 + Opus 4.8 (low/medium/high/xhigh/max)

### Embedding Configuration (`backend/config/embedding.js`)

Embedding uses **spaces** (model identity), not providers, as the correctness key. A vector is only comparable to rows tagged with the same space:

| Space | Dims | Providers |
|---|---|---|
| `openai-te3-small` | 1536 | openrouter, openai (interchangeable — same model) |
| `gemini-embed-001` | 768 | gemini |
| `mistral-embed` | 1024 | mistral |

Default provider: `openrouter`. Failover is only allowed within the same space. Shorter vectors are zero-padded to 1536 for pgvector (lossless for cosine).

### Middleware Modules

- `auth.js` — JWT validation; auth via `httpOnly` cookie (`auth_token`) with optional bearer fallback
- `tokenCheck.js` — per-user token limits; anonymous users get `ANONYMOUS_TOKEN_LIMIT` (default 10000)
- `sanitize.js` — strips HTML tags, decodes entities; preserves whitespace/newlines for code/markdown
- `csrf.js` — double-submit CSRF; `generateCsrfToken()` / `csrfProtection` middleware
- `sentryContext.js` — attaches user context to Sentry events

### Backend Utilities

- `backend/utils/authCookie.js` — cookie helper for `auth_token`
- `backend/utils/cookies.js` — generic cookie read/write helpers
- `backend/scripts/build-raptor-tree.js` — CLI to build RAPTOR trees (resumable, no serverless timeout)
- `backend/scripts/build-knowledge-graph.js` — CLI to extract entity/relation graph
- `backend/scripts/reindex-collection.js` — CLI to re-embed a collection with a different provider

---

## Frontend Overview

### Entry and Routing

- App root: `frontend/src/App.jsx`
- Route map:
  - `/login` — `LoginPage`
  - `/chat` — `ChatPage` (protected)
  - `/knowledge` — `KnowledgePage` (protected) **New**
  - `/admin` — `AdminPage` (admin-only, lazy-loaded)
- `AdminPage` and `KnowledgePage` are lazy-loaded (`React.lazy`) to keep their dependencies out of the main bundle

### State / Config

- Auth context: `frontend/src/context/AuthContext.jsx`
- Theme context: `frontend/src/context/ThemeContext.jsx`
- API client: `frontend/src/config/api.js`
- Session broadcast / CSRF: `frontend/src/utils/sessionBroadcast.js` — `getCsrfToken()`, `setCsrfToken()`, `broadcastLogout()`, `listenForLogout()`
- Idle logout: `frontend/src/hooks/useIdleLogout.js` **New** — signs user out after `VITE_IDLE_TIMEOUT_MINUTES` (default 30) of inactivity; shared via localStorage so all open tabs stay in sync; throttled activity writes (5s); Escape/visibility re-check on tab focus

### Key Pages

- `frontend/src/pages/LoginPage.jsx`
- `frontend/src/pages/ChatPage.jsx` — thin container composing chat hooks/components
- `frontend/src/pages/hooks/useChatSession.js` — stream/session orchestration; `selectedCollectionIds` and `webEnabled` are scoped per-chat (reset on switch/new)
- `frontend/src/pages/hooks/useChatComposer.js` — draft input and attachment handling
- `frontend/src/pages/AdminPage.jsx`
- `frontend/src/pages/KnowledgePage.jsx` **New** — Knowledge Base management hub: create/edit/delete collections, upload files, crawl URLs, add raw text/markdown, inspect chunks, view document status, build RAPTOR trees

### Key UI Components

- Chat UI: `frontend/src/components/chat/*`
- `ChatMessagesPanel.jsx` — message list
- `ChatInputPanel.jsx` — input bar, send, abort
- `ChatMemoryControls.jsx` — per-chat memory mode toggle
- `ChatQueuePopover.jsx` — queued message management
- `ChatUploadProgress.jsx` — per-file upload progress
- `ComposerPlusMenu.jsx` — `+` menu for KB collection selection and file attach; closes on Escape
- `ApprovalPrompt.jsx` — inline Yes/Other/No approval card for GENERATE_* tools
- `ClarificationPrompt.jsx` — structured clarification form before generation
- `ReasoningPanel.jsx` **New** — collapsible "Thought process" panel for reasoning models; shows "Thought for Ns" duration, collapsed by default
- `ThinkingToggle.jsx` **New** — Thinking toggle with per-model effort-level submenu (low/medium/high/max)
- `ModelSelector.jsx`, `UnifiedModelModal.jsx` — model picker with live provider catalogs
- `MessageBubble.jsx` — renders markdown, code blocks, CSV export, inline approvals, generated files, and bottom-right timestamps (`formatTime` 12-hour local time, `formatFullDateTime` tooltip, dual-theme styling)
- `MobileNav.jsx`, `Sidebar.jsx` — navigation including Knowledge Bases link
- Layout: `ThemeToggle.jsx`, `Toast.jsx`, `TokenBar.jsx`
- Admin: `frontend/src/components/admin/UserModal.jsx`
- Hook: `frontend/src/components/chat/useKnowledgeCollections.js`

### Frontend Utils

- `frontend/src/utils/sse.js` — `createSseParser()`: SSE frame parser (handles chunk-boundary splits, CRLF, multi-line data, malformed JSON)
- `frontend/src/utils/sessionBroadcast.js` — CSRF token storage and cross-tab logout broadcast

---

## Inline Approval Flow (GENERATE_* Tools)

All 10 file-generation tools are gated by an explicit user approval step. Full sequence:

1. **Intent detection** — `chatPipeline.service.js` detects generation intent via `ARTIFACT_INTENTS`; sends `ClarificationPrompt` if request lacks detail (`conversationHadClarification()` guard prevents re-arming)
2. **Approval request created** — `toolProcessor.service.js` calls `approvalManager` to persist in `human_approvals` and emits `approval_request` SSE
3. **Frontend prompt** — `ApprovalPrompt.jsx` shows **Yes, generate** / **Other** / **No**
4. **Polling** — backend polls `approvalManager` every 500ms for up to 2 minutes; stops immediately on stream abort
5. **Response handling:**
   - **Yes** → `POST /api/approval/:id/respond { response: true }` → generation proceeds
   - **No** → cancellation message
   - **Other** → user types instructions → AI revises → fresh `approval_request` with updated `summary` → cycle repeats

### SSE Event Types (complete)

| Event type | When emitted | Key fields |
|---|---|---|
| `connected` | Stream open | `status: "connected"` |
| `framework_status` | OrchestratorBrain phase | `message`, `step` |
| `approval_request` | Before any GENERATE_* tool | `approvalId`, `toolType`, `toolLabel`, `message`, `summary`, `options` |
| `tool_status` / `status` | Tool execution | `type`, `tool`, `status`, `message` |
| `chunk` | Streamed tokens | `type: "chunk"`, `text` |
| `reasoning` | Reasoning model thought stream | `type: "reasoning"`, `text` |
| `done` | Stream complete | `tokensUsed`, `topicId`, `assistantMessageId`, `model`, `cacheHit`, `generatedFiles`, `responseTime` |
| `error` | Pipeline/provider error | `type: "error"`, `error`, `errorType`, `suggestedModels` |

---

## Knowledge Base (RAG 2.0) — New Feature

A complete knowledge management system separate from the chat-upload RAG pipeline.

### Architecture

```
Knowledge Collection
  └── Knowledge Documents (files / web crawls / raw text)
        └── Knowledge Chunks (parent-child, pgvector + FTS)
              ├── RAPTOR Summary Nodes (multi-level abstraction tree)
              └── Knowledge Graph (entities + relations)
```

### Retrieval Pipeline (`searchKnowledgeCollections`)

1. **Query expansion** (optional, `RAG_QUERY_EXPANSION_ENABLED`) — alternate phrasings via `queryTransform.service.js`
2. **HyDE** (optional, `RAG_HYDE_ENABLED`) — embed a hypothetical answer as an extra dense probe
3. **Dense retrieval** — pgvector cosine search per expanded query
4. **Sparse retrieval** — PostgreSQL FTS (GIN inverted index on `knowledge_chunks`) per expanded query
5. **GraphRAG** (optional, `GRAPHRAG_ENABLED`) — entity name-match → hop along relations → retrieve linked chunks
6. **RRF fusion** — merge all candidate lists by reciprocal rank
7. **Cross-encoder reranking** (optional, Cohere `rerank-v3.5`) — final ordering; passages below `RAG_RERANK_MIN_RELEVANCE` are dropped
8. **Parent-window expansion** — return the N surrounding chunks alongside each hit for richer context

### Ingestion

- `ingestDocumentContent()` — splits text into parent-child chunks, embeds, writes to `knowledge_chunks` + `knowledge_chunk_parents`
- Vision extraction (`visionExtraction.service.js`) — images extracted to text at ingest; free-first ordering, rate-limit cooldown
- PDF OCR (`pdfOcr.service.js`) — OCR fallback when text layer is too sparse (Mistral OCR → OpenRouter chat model)
- Web crawl (`knowledgeCrawler.service.js`) — depth-limited BFS, SSRF guard, HTML→clean text

### Background Build Jobs (CLI scripts)

- `backend/scripts/build-raptor-tree.js` — builds RAPTOR summary trees per document/collection; resumable
- `backend/scripts/build-knowledge-graph.js` — extracts entities/relations; one LLM call per chunk
- `backend/scripts/reindex-collection.js` — re-embeds a collection (e.g., after provider change)

### KB Tool Tag

`[SEARCH_KB collectionId="..."]` — agentic retrieval tool exposed to the AI during chat. Enables multi-turn KB lookups with better-refined queries on each round.

---

## Database and SQL Assets

- Primary schema: `database/schema.sql`
- Deployed schema snapshot: `database/schema_export.sql` (source of truth for live constraints)
- Migrations (all idempotent unless noted):

| File | Purpose |
|---|---|
| `token_optimization.sql` | Token usage indexes |
| `migration_add_message_embeddings.sql` | `message_embeddings` table for cross-chat memory |
| `migration_add_locked_until.sql` | `users.locked_until` for brute-force lockout |
| `migration_delete_topic_cascade.sql` | `delete_topic_cascade` RPC |
| `migration_delete_user_cascade.sql` | User deletion cascade |
| `migration_drop_sessions.sql` | Drop legacy sessions table |
| `migration_add_human_approvals.sql` | `human_approvals` table |
| `migration_add_approval_user_scope.sql` | **New**: adds `user_id` to `human_approvals` (IDOR fix) |
| `migration_add_rag2_knowledge_management.sql` | **New**: `knowledge_collections`, `knowledge_documents`, `knowledge_chunks`, `knowledge_chunk_parents`, `match_knowledge_chunks` RPC |
| `migration_add_knowledge_fts.sql` | **New**: GIN inverted index on `knowledge_chunks.fts_vector` for true sparse retrieval |
| `migration_add_knowledge_graph.sql` | **New**: `knowledge_entities`, `knowledge_relations`, `knowledge_entity_chunks`, `match_knowledge_graph` RPC |
| `migration_add_rate_limiting.sql` | **New**: `rate_limit_counters` + `login_attempt_counters` tables for serverless-safe rate limiting |
| `migration_add_reasoning_to_messages.sql` | **New**: `messages.reasoning` column for storing chain-of-thought |
| `migration_add_user_timezone.sql` | **New**: `users.timezone` (IANA) for temporal context resolution |
| `migration_add_embedding_space.sql` | **New**: `embedding_space` column on `uploaded_files_rag`, `message_embeddings`, `query_cache`; all searches now filter by space |
| `migration_add_admin_analytics.sql` | **New**: `get_admin_analytics()` SQL aggregate function (replaces JS-side 1000-row-capped aggregation) |
| `migration_add_prompt_cache_analytics.sql` | **New**: `query_analytics.prompt_cache_read_tokens` / `prompt_cache_write_tokens`, `created_at` index, and `get_admin_analytics()` extended with `promptCacheReadTokens` / `promptCacheWriteTokens` / `promptCacheHitRate` (share of REQUESTS with a cache hit — not read/(read+write), which collapses to a meaningless 100% on every provider except Anthropic), plus a `dailyUsage` shape fix. Also redefines `cache_hit` to mean response-cache only |
| `migration_enable_rls_all_tables.sql` | Row-level security for all tables |
| `migration_add_generated_files_to_messages.sql` | `messages.generated_files` column |

### Key Table Additions (New)

**`knowledge_collections`** — user-owned named knowledge bases (name, icon, color, `embedding_provider`, `is_public`)

**`knowledge_documents`** — source documents in a collection (source type: file/crawl/text, `processing_status`)

**`knowledge_chunks`** — indexed chunks with pgvector embedding + `fts_vector` GENERATED column for FTS + `chunk_level` (0=leaf, >0=RAPTOR summary) + `embedding_space`

**`knowledge_entities` / `knowledge_relations` / `knowledge_entity_chunks`** — GraphRAG graph nodes/edges

**`rate_limit_counters`** — `(key, count, reset_at)` for `express-rate-limit` Supabase store

**`login_attempt_counters`** — `(identifier, attempts, locked_until)` for brute-force lockout

**`messages.reasoning`** — stores model chain-of-thought for reloaded history

**`users.timezone`** — IANA timezone preference (overrides browser-reported zone)

**`*.embedding_space`** — space tag on all vector tables; search RPCs filter by it

---

## Artifact Lifecycle

| Type | Tables written | `topic_id` source |
|---|---|---|
| User-uploaded | `uploaded_files_rag` + `uploaded_files` | `activeTopic?.id` at upload time |
| AI-generated | `uploaded_files_rag` only | `metadata.topicId` from SSE `done` event |

`uploaded_files_rag.topic_id` is `ON DELETE CASCADE` in the deployed schema. `deleteTopic` in `history.controller.js` explicitly deletes from both tables before calling the RPC, so cleanup works even if the SQL function is not deployed.

---

## Security Fixes Applied

| File | Fix |
|---|---|
| `server.js` | CORS: exact `includes` match replaces `startsWith` to prevent subdomain spoofing |
| `server.js` + `csrf.js` | CSRF middleware enabled globally; double-submit pattern |
| `auth.controller.js` + `auth.js` | Auth moved to `httpOnly` cookie with optional bearer fallback |
| `tokenCheck.js` | Anonymous token cap: `ANONYMOUS_TOKEN_LIMIT` (default 10000) |
| `sanitize.js` | Whitespace collapse removed; newlines preserved for code/markdown |
| `toolProcessor.service.js` | PII: web search query content removed from logs |
| `Sidebar.jsx` / `MobileNav.jsx` | Stored XSS: `safe()` HTML escaper had identity-only replacements; fixed with real entity escaping (ampersand first) before `document.write()` |
| `approval.controller.js` | IDOR: `canAccessApproval()` ownership check added; non-admin users can only respond to their own approvals |
| `auth.controller.js` | Brute-force lockout: `login_attempt_counters` table (Supabase-backed); serverless-safe |
| `rateLimitStore.service.js` | Serverless rate-limit: `MemoryStore` replaced with Supabase store — counters survive across lambda instances |
| `server.js` + `frontend/vercel.json` | CSP relocated: the policy that governs the UI now ships as a header from the frontend deployment (no `unsafe-inline` for scripts). The backend serves JSON, so `script-src`/`style-src` set there reached no page a user loads; it now sends a strict `default-src 'none'` suited to an API origin. **`connect-src` hardcodes the backend origin — a changed `VITE_API_URL` must be added there or every API call is blocked** |
| `upload.routes.js` | Chunked-upload ownership verified against the shared `upload_chunks_staging` table, not only the per-instance in-memory Map (empty on a serverless cold start, so the check silently passed) |
| `knowledge.routes.js` + `upload.routes.js` | Blob URL validation (`isValidVercelBlobUrl`) on `process-blob` endpoints |
| `AuthContext.jsx` | Idle logout no longer tears down a 30-day "Remember me" session; `rememberMe` rides the JWT and is surfaced by `/auth/me` |

---

## Environment Variables

### Backend — Required

- `JWT_SECRET` (≥32 chars)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `FRONTEND_URL`

### Backend — Optional

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5000` | HTTP listen port |
| `NODE_ENV` | `development` | Logging format |
| `SENTRY_DSN` | — | Error tracking |
| `ANONYMOUS_TOKEN_LIMIT` | `10000` | Token cap for unauthenticated requests |
| `DEEPSEEK_API_KEY` | — | **Required for default model** |
| `GEMINI_API_KEY` | — | Gemini models + summarization fallback |
| `GROQ_API_KEY` | — | Groq models (free) |
| `MISTRAL_API_KEY` | — | Mistral models |
| `COHERE_API_KEY` | — | Cohere + cross-encoder reranking |
| `OPENAI_API_KEY` | — | OpenAI models + same embedding space as OpenRouter |
| `ANTHROPIC_API_KEY` | — | Claude models |
| `OPENROUTER_API_KEY` | — | OpenRouter + default embedding provider |
| `TOGETHER_API_KEY` | — | Together AI live catalog |
| `ANYAPI_API_KEY` | — | Generic OpenAI-compatible endpoint |
| `GEMINI_SUMMARY_API_KEY` | — | Dedicated key for summarization |
| `MISTRAL_SUMMARY_API_KEY` | — | Dedicated key for summarization |
| `CEREBRAS_SUMMARY_API_KEY` | — | Summarization fallback (Llama 3.1-8b) |
| `EXA_API_KEY` | — | Web search |
| `TAVILY_API_KEY` | — | Web search |
| `FIRECRAWL_API_KEY` | — | Web search + URL extraction |
| `SERPAPI_API_KEY` | — | Web search |
| `LANGSEARCH_API_KEY` | — | Web search aggregation |
| `PARALLEL_API_KEY` | — | Parallel AI (web search) |
| `GITHUB_TOKEN` | — | Raises GitHub API rate limits for repo deep-read |
| `APP_DEFAULT_TIMEZONE` | `UTC` | IANA timezone when request carries none |
| `TEMPORAL_PRECISION_MS` | `60000` | "Now" rendering granularity |
| `VISION_PREFER_FREE` | `true` | Lead with free vision model at ingest |
| `VISION_FREE_MODEL` | `mistral-small-latest` | Free vision model |
| `VISION_MODEL` | `google/gemini-2.5-flash-lite` | Paid vision model |
| `VISION_COOLDOWN_MS` | `120000` | Rate-limited provider cooldown |
| `PDF_OCR_ENABLED` | `true` | Enable OCR fallback for PDFs |
| `PDF_OCR_MODEL` | `mistral-ocr-latest` | OCR provider |
| `PDF_OCR_MIN_CHARS_PER_PAGE` | `100` | Text density below which OCR is triggered |
| `PDF_OCR_MAX_PAGES` | `50` | Hard cap per document |
| `PDF_OCR_TIMEOUT_MS` | `120000` | OCR call timeout |
| `OCR_CACHE_DIR` | OS tmpdir | tesseract.js model cache location |
| `RAPTOR_ENABLED` | `true` | Build RAPTOR summary trees |
| `RAPTOR_BRANCH_FACTOR` | `5` | Children per cluster |
| `RAPTOR_MAX_LEVELS` | `3` | Max tree depth |
| `RAPTOR_MIN_CHUNKS` | `8` | Min chunks before tree is built |
| `RAPTOR_CONCURRENCY` | `3` | Parallel summarization calls |
| `RAPTOR_FREE_MODEL` | `mistral-small-latest` | Free RAPTOR model |
| `RAPTOR_MODEL` | `google/gemini-2.5-flash-lite` | RAPTOR model |
| `RAPTOR_SUMMARY_PENALTY` | `0.05` | Score penalty for summary nodes |
| `RAPTOR_REQUEST_BUDGET_MS` | `280000` | API-triggered build time budget |
| `GRAPHRAG_ENABLED` | `true` | Entity/relation graph retrieval |
| `GRAPHRAG_MAX_HOPS` | `1` | Graph traversal depth |
| `GRAPHRAG_MAX_ENTITIES` | `8` | Max entities extracted per chunk |
| `GRAPHRAG_MAX_RELATIONS` | `8` | Max relations extracted per chunk |
| `GRAPHRAG_CONCURRENCY` | `3` | Parallel extraction calls |
| `GRAPHRAG_FREE_MODEL` | `mistral-small-latest` | Free extraction model |
| `GRAPHRAG_MODEL` | `google/gemini-2.5-flash-lite` | Extraction model |
| `RAG_RERANK_LLM_MODEL` | `google/gemini-2.5-flash-lite` | Fallback reranker when Cohere unreachable |
| `PDF_OCR_FALLBACK_MODEL` | `google/gemini-2.5-flash-lite` | OCR fallback when Mistral OCR unreachable |
| `QUERY_TRANSFORM_MODEL` | `google/gemini-2.5-flash-lite` | Query expansion/HyDE model |

### Frontend

- `VITE_API_URL` — backend base URL
- `VITE_SENTRY_DSN` — optional frontend Sentry DSN
- `VITE_IDLE_TIMEOUT_MINUTES` — idle logout timeout in minutes (default 30)

---

## Related Docs

- Implementation guide: [`docs/GUIDE.md`](./GUIDE.md)
- Testing guide: [`docs/testing/TESTING.md`](./testing/TESTING.md)
- Management summary: [`docs/MANAGEMENT_PRESENTATION.md`](./MANAGEMENT_PRESENTATION.md)
