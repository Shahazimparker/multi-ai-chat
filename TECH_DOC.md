# Multi-AI Chat Technical Documentation

This document is the technical reference for the current codebase state.

## Architecture

- Frontend: React app in `frontend/`
- Backend: Node.js/Express API in `backend/`
- Database: Supabase/PostgreSQL with `pgvector`
- Deployment: Vercel (`frontend/vercel.json`, `backend/vercel.json`)

## Backend Overview

### Entry and middleware

- Entry point: `backend/server.js`
- Security/logging: `helmet`, `cors`, `morgan`
- Request parsing: JSON body (`10mb`)
- Global middleware: Sentry handlers, token cleanup jobs
- Main routes:
  - `/api/auth`
  - `/api/chat`
  - `/api/admin`
  - `/api/history`
  - `/api/upload`
  - `/api/health`

### Core route modules

- `backend/routes/auth.routes.js`
- `backend/routes/chat.routes.js`
- `backend/routes/admin.routes.js`
- `backend/routes/history.routes.js`
- `backend/routes/upload.routes.js`

### Controllers

- `backend/controllers/auth.controller.js`
- `backend/controllers/chat.controller.js`
- `backend/controllers/admin.controller.js`
- `backend/controllers/history.controller.js`

### Streaming Architecture

- `backend/services/chatPipeline.service.js` — Single shared pipeline behind the canonical `/stream` route and legacy `/message` JSON compatibility route. Handles: model validation → query compression → cache check (optional) → embedding + RAG → history → system prompt → tool loop → persistence → analytics.
- **Real provider streaming**: Each AI provider service has a `callXxxStream()` variant that uses the SDK's native `stream: true` parameter. Text deltas are forwarded to the client via an `onChunk` callback as they arrive from the provider. No artificial `setTimeout` delays.
- `dispatchToAIStream()` in `backend/services/ai/dispatcher.service.js` routes to the correct provider's streaming function.
- `runToolLoop()` in `backend/services/toolLoop.service.js` accepts an `onStreamChunk` callback. During tool-call rounds, chunks are buffered internally; only the final round (no tool calls) forwards chunks to the client.
- `backend/services/orchestratorBrain.service.js` is an optional pre-stream planning layer (`GraphBuilder`, `SmartAgent`, `AgentOrchestrator`, callbacks, `ExecutionTracer`, flow dashboard/optimizer, output parser, in-memory vector store, hybrid retriever) that can emit `framework_status` SSE events. It is off by default (`ENABLE_ORCHESTRATOR_BRAIN=false` — see Pipeline Feature Flags) and no frontend listener consumes its telemetry.
- Human approvals are deploy-safe: `backend/services/humanApproval.service.js` supports persistent Supabase-backed requests and non-blocking serverless mode; `backend/routes/approval.routes.js` exposes admin approve/reject APIs; schema lives in `database/migration_add_human_approvals.sql`.
- Providers with streaming support: OpenAI, Groq, Claude, Gemini, Mistral, Cohere, DeepSeek, OpenRouter, Together, AnyAPI — all 10 providers.

### Pipeline Feature Flags

`CANONICAL_CHAT_PIPELINE_FLAGS` (frozen object in `chatPipeline.service.js`) controls which optional features are active on the canonical `/stream` and `/message` routes:

| Flag | Default | Meaning |
|---|---|---|
| `exactCacheEnabled` | `false` | Exact SHA-256 cache lookup disabled for live chat (avoids stale answers) |
| `identityCheckEnabled` | `true` | Identity/persona questions short-circuit before AI dispatch |
| `perQueryLimitEnabled` | `true` | Per-query token limit enforced from `users.per_query_limit` |
| `dynamicBudgetEnabled` | `true` | Token budget allocated dynamically based on query complexity |
| `memoryEnabled` | `true` | Cross-chat RAG memory (`embedAndStoreMessage` / `searchMemory`) active |
| `cacheResponse` | `true` | Successful responses written to semantic cache |
| `postSaveEmbedding` | `true` | Message embedded into `message_embeddings` after DB save |
| `enableOrchestratorBrain` | `false` | Custom AI framework runtime initialised before provider streaming. Off by default — it costs 2-3 extra LLM calls per message (routing decision + SmartAgent plan) whose outputs are not consumed, since the model-switch gate they fed was retired. Set `ENABLE_ORCHESTRATOR_BRAIN=true` to re-enable; its tokens are then counted into `totalAITokens` and billed. |

To override any flag for a specific route, spread `CANONICAL_CHAT_PIPELINE_FLAGS` and overwrite the target key when calling `runChatPipeline()`.

### Core services (Existing)

- Chat orchestration: `backend/services/chatPipeline.service.js`
- Context and memory: `backend/services/context.service.js`, `backend/services/memory.service.js`, `backend/services/summary.service.js`
- `memory.service.js` now exports `embedAndStoreMessage` and `searchMemory` for RAG-based cross-chat memory (accurate mode only)
  - Cross-chat memory persisted in `message_embeddings` table; searched via `search_memory` Supabase RPC
  - Memory context trimmed with token-budget-aware `trimTextByTokens` (600 token fixed budget, split evenly across results)
- RAG and embeddings: `backend/services/rag.service.js` (hybrid reranking: cosine+BM25+Jaccard+RRF with numeric critical miss protection)
- File pipeline: `backend/services/fileUpload.service.js`
  - Upload embeddings include max-context recovery: `EMBED_INPUT_TOO_LONG` from `rag.service.js` triggers smaller chunk retries and adaptive hard split fallback in `fileUpload.service.js`.
- Cache: `backend/services/cache.service.js`
  - Exact cache reads are disabled for live chat to avoid stale answers; successful responses can still be stored for semantic/RAG-aware reuse.
  - Semantic cache (`getSemanticCachedResponse`, pgvector cosine ≥ 0.92) remains active when RAG provides embeddings.
- Token budgeting: `backend/services/tokenBudget.service.js`
- Analytics: `backend/services/analytics.service.js`
- Compression: `backend/services/compress.service.js`
- Tool execution helpers: `backend/services/tools/webSearch.service.js`
  - `webSearch.service.js` uses primary fallback in this order: `Exa -> Firecrawl -> Tavily -> SerpAPI`, then always aggregates LangSearch.
  - **Removed:** `codeExecute.service.js` and the `[EXECUTE_CODE]` tool tag. The worker threw
    `SyntaxError: Unexpected eval or arguments in strict mode` at construction on every input, so
    the tool had never executed anything. Its `worker_threads` design was also not a sandbox — it
    shared the server process, and shadowing `process`/`require`/`eval` with `undefined` is
    escapable via constructor chains (`(function(){}).constructor(...)`), which would have exposed
    `process.env` (JWT secret, Supabase service key, all provider keys). If code execution is needed
    again, it must run out-of-process in a real isolate or container, not in a worker thread.
- URL reading helpers:
  - `backend/services/tools/urlReader.service.js` — extracts/validates URLs from user query and injects URL context. Blocks private/internal hosts (loopback, RFC-1918 ranges, `.local`, `.internal`) and non-HTTP/S protocols to prevent SSRF.
  - `backend/services/tools/githubReader.service.js` — GitHub repo deep-read (tree + raw file content with limits)
  - `backend/services/tools/siteReaders.service.js` — site-specific readers for GitLab, Bitbucket, StackOverflow, Notion, Confluence, arXiv, PubMed, Google Docs, SharePoint, Medium/Substack, YouTube, Reddit, Quora, API docs, Gov/Legal
  - Runtime order: site-specific reader first, then generic provider fallback (Firecrawl/Tavily/Exa)
  - `rerank.service.js` was deleted: it had no importer in any runtime path. Reranking is done in-process by the hybrid scorers in `rag.service.js` / `memory.service.js`.
- File generation: `backend/services/imageGeneration.service.js` (Recraft/FLUX via OpenRouter), `backend/services/pptGeneration.service.js` (pptxgenjs), `backend/services/pdfGeneration.service.js` (pdfkit), `backend/services/excelGeneration.service.js` (exceljs), `backend/services/wordGeneration.service.js` (docx), `backend/services/csvGeneration.service.js`, `backend/services/chartGeneration.service.js` (SVG), `backend/services/htmlGeneration.service.js`, `backend/services/jsonGeneration.service.js`, `backend/services/markdownGeneration.service.js`

### AI Framework Services (LangChain/LangGraph/LangSmith Equivalent)

**Document & Text Processing:**
- `documentLoader.service.js` — Load 40+ file formats with text extraction
- `textSplitter.service.js` — 4 intelligent chunking strategies with auto-selection

**Vector & Semantic Search:**
- `vectorStore.service.js` — Multiple backend support (PgVector, In-Memory, Hybrid)
- `retriever.service.js` — 6 search strategies (Vector, BM25, Hybrid, Metadata, Reranker, Chained)

**Language Model Integration:**
- `outputParser.service.js` — 5 parser types (JSON, Markdown, CSV, Regex, Composite)
- `promptTemplate.service.js` — 8 template types with variable interpolation

**Orchestration & Workflows:**
- `chain.service.js` — 6 chain types (Simple, Conditional, Parallel, Composer, Map, Loop)
- `agent.service.js` — ReAct pattern with dynamic tool selection
- `graphWorkflow.service.js` — DAG-based workflows with conditional routing
- `agentOrchestrator.service.js` — SmartAgent with intelligent orchestration

**Memory & State:**
- `memory.service.js` — 6 in-process memory strategies (Buffer, Summary, Entity, TokenBuffer, Window, Combined) + `embedAndStoreMessage` + `searchMemory` with hybrid reranking (cosine+BM25+Jaccard+RRF) for cross-chat RAG memory
  - Hybrid reranking weights: **55% cosine + 30% BM25 + 15% Jaccard** with +0.1 numeric boost via RRF fusion
  - Thresholds: `RAG_HYBRID_THRESHOLD = 0.52`, `MEMORY_HYBRID_THRESHOLD = 0.56`
  - External LangSearch rerank API is intentionally unwired from runtime (free-tier reliability constraints)
- `loopManagement.service.js` was deleted — 573 lines with no importer anywhere in the codebase. The tool loop that is actually used lives in `toolLoop.service.js`.

**Observability & Control:**
- `callbacks.service.js` — Event-driven lifecycle hooks for monitoring; global manager auto-initializes Logger, CostTracker, MetricsCollector on first use; ApprovalHandler wired to approval lifecycle events
- `humanApproval.service.js` — Approval checkpoints with state snapshots; timeout clamped to 1-hour hard cap; approvalFn fire-and-forget with auto-reject on notification failure
- `executionTracer.service.js` — Complete step-by-step execution tracing with TTL+LRU eviction (100 trace cap, 1-hour TTL); wired into Agent (`agent.service.js`) and SmartAgent (`agentOrchestrator.service.js`) tool/LLM calls via optional `tracer` constructor option
- `flowVisibility.service.js` — Variable tracking, state diffing, flow analysis and visualization

**Central Export:**
- `index.js` — Centralized export point for all 16+ AI framework services. Exposes each service as a lazily-loaded namespace (`chain`, `agent`, `graphWorkflow`, …), not as flat class exports.

### AI provider layer

- Dispatcher: `backend/services/ai/dispatcher.service.js`
- Provider modules:
  - `gemini.service.js`
  - `groq.service.js`
  - `mistral.service.js`
  - `deepseek.service.js`
  - `claude.service.js`
  - `openrouter.service.js`
  - `openai.service.js`
  - `cohere.service.js`
  - `together.service.js`
  - `anyapi.service.js`
  - `unified.service.js` (shared OpenAI-compatible caller)

### Model configuration

- Source of truth: `backend/config/models.js`
- Current configured registry: 15 model entries
- Configured provider families in the registry: DeepSeek, Groq, Gemini, Mistral, Claude, OpenRouter
- Live model catalog endpoint support (not static model registry entries): `openrouter`, `together`, `anyapi` via `backend/services/modelCatalog.service.js`

### Middleware modules

- Auth: `backend/middleware/auth.js`
- Token quota: `backend/middleware/tokenCheck.js` — enforces per-user token limits; anonymous users get a configurable cap (`ANONYMOUS_TOKEN_LIMIT`, default 10000)
- Input sanitization: `backend/middleware/sanitize.js` — strips HTML tags and decodes entities; preserves whitespace/newlines for code/markdown
- Sentry context: `backend/middleware/sentryContext.js`

## Frontend Overview

### Entry and routing

- App root: `frontend/src/App.jsx`
- Route map:
  - `/login`
  - `/chat`
  - `/admin`

### State/config

- Auth context: `frontend/src/context/AuthContext.jsx`
- Theme context: `frontend/src/context/ThemeContext.jsx`
- API client: `frontend/src/config/api.js`

### Key pages

- `frontend/src/pages/LoginPage.jsx`
- `frontend/src/pages/ChatPage.jsx` - thin container that composes the chat hooks/components
- `frontend/src/pages/hooks/useChatSession.js` - chat stream/session orchestration
- `frontend/src/pages/hooks/useChatComposer.js` - draft input and attachment handling
- `frontend/src/pages/AdminPage.jsx`

### Key UI components

- Chat UI: `frontend/src/components/chat/*`
  - Generated-file preview/download in `MessageBubble.jsx` uses `api` client endpoints (`/upload/download/:id`, `/upload/preview/:id`) for baseURL-safe behavior on real mobile.
- Chat messages panel: `frontend/src/components/chat/ChatMessagesPanel.jsx`
- Chat input panel: `frontend/src/components/chat/ChatInputPanel.jsx`
- Memory controls: `frontend/src/components/chat/ChatMemoryControls.jsx`
- Queue popover: `frontend/src/components/chat/ChatQueuePopover.jsx`
- Upload progress: `frontend/src/components/chat/ChatUploadProgress.jsx`
- Layout/theme/token bar: `frontend/src/components/layout/*`
- Admin modal: `frontend/src/components/admin/UserModal.jsx`

## Inline Approval Flow (GENERATE_* Tools)

All 10 file-generation tools (`GENERATE_PPT`, `GENERATE_IMAGE`, `GENERATE_PDF`, `GENERATE_EXCEL`, `GENERATE_DOCX`, `GENERATE_CSV`, `GENERATE_CHART`, `GENERATE_HTML`, `GENERATE_JSON`, `GENERATE_MD`) are gated by an explicit user approval step before execution. The full sequence:

1. **Intent detection** — `chatPipeline.service.js` detects a generation intent via `ARTIFACT_INTENTS`. If the request lacks sufficient detail, structured clarifying questions are sent to the frontend via `ClarificationPrompt.jsx` before proceeding.
2. **Approval request created** — `toolProcessor.service.js` calls `approvalManager` to persist a record in the `human_approvals` table and emits an `approval_request` SSE event.
3. **Frontend prompt** — `ApprovalPrompt.jsx` shows three options: **Yes, generate** / **Other** (custom instructions) / **No**.
4. **Polling** — backend polls `approvalManager` every 500 ms for up to 2 minutes (`APPROVAL_TIMEOUT_MS = 120000`). Polling stops immediately if the stream is aborted.
5. **Response handling:**
   - **Yes** → `POST /api/approval/:id/respond { response: true }` → `waitForUserApproval` returns `{ approved: true, instructions: '' }` → generation proceeds.
   - **No** → `POST /api/approval/:id/respond { response: false }` → returns cancellation message to chat.
   - **Other** → user types instructions (max 500 chars) → `POST /api/approval/:id/respond { response: true, reason: "<instructions>" }` → backend detects non-default reason → returns `[USER MODIFICATION REQUEST]` to AI → AI revises plan → emits a fresh `approval_request` SSE with updated `summary` → cycle repeats until Yes or No.
6. **Timeout** → request auto-rejected after 2 minutes if no response.

**`waitForUserApproval` return shape:** `{ approved: boolean, reason: string, instructions: string }` — `instructions` is non-empty only when the user submitted modifications via the Other path.

**`buildSummary(toolName, context)` — per-tool human-readable plan string sent in `approval_request`:**

| Tool | Summary fields |
|---|---|
| `GENERATE_IMAGE` | `Prompt: "..."` |
| `GENERATE_PPT` | `Title: "..."`, `Theme: ...`, `Slides (N):` numbered titles (first 8, then `… and N more`) |
| `GENERATE_PDF` / `GENERATE_DOCX` | `Title: "..."`, `Sections (N):` headings (first 6, then `… and N more`) |
| `GENERATE_EXCEL` | `Title: "..."`, `Sheets (N): Sheet1, Sheet2, …` |
| `GENERATE_CSV` | `Columns (N): col1, col2`, `Rows: N` |
| `GENERATE_CHART` | `Type: bar`, `Title: "..."`, `Data points: a, b, c` |
| `GENERATE_HTML` / `GENERATE_JSON` / `GENERATE_MD` | Title and type |

### SSE Event Types (complete)

| Event type | When emitted | Key fields |
|---|---|---|
| `connected` | Immediately on stream open | `status: "connected"` |
| `framework_status` | During OrchestratorBrain pre-stream phase | `message`, `step` |
| `approval_request` | Before any GENERATE_* tool executes | `approvalId`, `toolType`, `toolLabel`, `message`, `summary`, `options: ['yes','other','no']` |
| `tool_status` / `status` | During tool execution (web search, DB query, generation) | `type`, `tool`, `status`, `message` |
| `chunk` | Streamed provider tokens | `type: "chunk"`, `text` |
| `done` | Stream complete | `tokensUsed`, `topicId`, `assistantMessageId`, `model`, `cacheHit`, `generatedFiles`, `orchestratorBrain`, `responseTime` |
| `error` | Pipeline or provider error | `type: "error"`, `error`, `errorType`, `suggestedModels`, `recommendedModelId`, `failedModelId` |

> A second `approval_request` event arrives on the same stream when the "Other" modification path is used — after the AI revises its plan.

### Artifact Intent Clarification

`ARTIFACT_INTENTS` in `chatPipeline.service.js` defines per-intent detection and clarification questions. When `hasEnoughDetails(text)` returns false, the pipeline emits a clarification form instead of proceeding to generation.

**PPT clarification fields:** Topic (text), Title (text, optional), Slides (select: 4/6/8, default 6), Theme (select, default `modern_corporate`), Audience (select: executives/team members/clients).

**20 available PPT themes:** `modern_corporate`, `graphite_gold`, `arctic_blue`, `midnight_plum`, `teal_glass`, `startup_bold`, `forest_night`, `slate_coral`, `golden_age`, `cobalt_bold`, `emerald_glass`, `violet_tech`, `ocean_depth`, `ruby_noir`, `sandstone_editorial`, `rose_creative`, `charcoal_lime`, `clean_minimal`, `sunset_warm`, `mono_editorial`.

## Artifact Lifecycle

AI-generated files (code blocks the AI writes) and user-uploaded files both land in `uploaded_files_rag`. They differ in one critical way:

| Type | Tables written | `topic_id` source |
|---|---|---|
| User-uploaded | `uploaded_files_rag` + `uploaded_files` | `activeTopic?.id` at upload time |
| AI-generated | `uploaded_files_rag` only | `metadata.topicId` from the SSE `done` event (after stream) |

**`uploaded_files_rag.topic_id` is `ON DELETE CASCADE` in the actual deployed schema** (`schema_export.sql`). This means Postgres auto-deletes file rows when their topic is deleted — but only for rows where `topic_id` is non-null and matches the deleted topic.

**Known fix (useChatSession.js):** For new chats, `activeTopic` is null at send time. The backend creates the topic during the stream and returns `topicId` in the `done` SSE event. `topicIdToUse` is updated from `metadata.topicId` before generated files are saved, so they are stored with the correct `topic_id`.

**Known fix (history.controller.js):** The `delete_topic_cascade` SQL function may not be deployed in all environments. `deleteTopic` now explicitly deletes from `uploaded_files_rag` and `uploaded_files` by `topic_id` before calling the RPC, guaranteeing file cleanup regardless of the deployed function version.

**Known fix (Sidebar.jsx):** After a chat is deleted the artifact list is re-fetched from `/upload/files` so stale entries no longer appear in the sidebar.

## Database and SQL Assets

- Primary schema: `database/schema.sql`
- Actual deployed schema snapshot: `database/schema_export.sql` (use this as source of truth for live constraints)
- Additional migrations and utility scripts:
  - `database/token_optimization.sql`
  - `database/migration_add_message_embeddings.sql`
  - `database/migration_add_locked_until.sql`
  - `database/migration_delete_topic_cascade.sql`

> **Note:** `schema.sql` and `schema_export.sql` differ on `uploaded_files_rag.topic_id`: the local schema says `ON DELETE SET NULL`; the actual deployed constraint is `ON DELETE CASCADE`. Always check `schema_export.sql` for live FK behavior.

### `message_embeddings` table (added by `migration_add_message_embeddings.sql`)

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` | PK |
| `user_id` | `UUID` | FK → `users(id) ON DELETE CASCADE` |
| `topic_id` | `UUID` | FK → `topics(id) ON DELETE CASCADE` |
| `message_id` | `UUID` | FK → `messages(id) ON DELETE CASCADE`; upsert conflict key |
| `role` | `TEXT` | `'user'` or `'assistant'` |
| `content` | `TEXT` | Raw message text |
| `embedding` | `vector(1536)` | HNSW index (`vector_cosine_ops`) |
| `created_at` | `TIMESTAMPTZ` | |

A `AFTER DELETE` trigger on `messages` (`trg_cleanup_message_embedding`) auto-deletes the corresponding embedding row when a message is deleted. The `search_memory` RPC accepts `(query_embedding, p_user_id, p_exclude_topic, match_threshold, match_count)` and excludes the current topic from results. **Prerequisite:** run this migration before using `accurate` memory mode.

### `human_approvals` table (added by `migration_add_human_approvals.sql`)

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT` | PK (string ID generated by service) |
| `type` | `TEXT` | `'approval'` \| `'input'` \| `'selection'` \| `'feedback'` |
| `title` / `description` | `TEXT` | Human-readable prompt |
| `context` | `JSONB` | Execution state snapshot |
| `options` | `JSONB` | Available choices for selection type |
| `status` | `TEXT` | `pending` \| `approved` \| `rejected` \| `expired` |
| `response` | `JSONB` | User's response value |
| `reason` | `TEXT` | Approval reason or user instructions |
| `approver` | `TEXT` | User email or `'system'` |
| `required_by` | `TEXT` | Node/step that created the request |
| `expires_at` / `approved_at` | `TIMESTAMPTZ` | |

Index on `(status, created_at DESC)` for efficient pending-approval queries.

## Bug Fixes and Improvements Applied

### Critical Bugs Fixed
| File | Fix |
|---|---|
| `retriever.service.js` | `RerankerRetriever`: safe JSON array extraction with regex + try-catch; falls back to original results on bad LLM output |
| `retriever.service.js` | `BM25Retriever`: eliminated N+1 pattern with `docMap` (id→doc) and `tokenCache` (id→tokens) Maps; O(1) lookup |
| `retriever.service.js` | `HybridRetriever`: null guards on required retrievers; `Promise.all` parallelism for both sub-retrievers |
| `memory.service.js` | `SummaryMemory.add()`: `recentMessages` was never populated — added explicit push so summarization threshold can trigger |
| `memory.service.js` | `WindowMemory.add()`: `slice(0, -windowSize)` was wrong direction — fixed to `slice(0, length - windowSize)` |
| `callbacks.service.js` | `MetricsCollectorHandler.getStats()`: division-by-zero guard when `operationCount === 0` |
| `executionTracer.service.js` | Unbounded trace Map memory leak — added TTL eviction (1hr) + LRU cap (100 traces) via `_evictStaleTraces()` |
| `humanApproval.service.js` | Approval timeout: `null` timeout no longer means infinite wait — clamped to `MAX_APPROVAL_TIMEOUT_MS = 3600000` |
| `humanApproval.service.js` | `approvalFn` now fire-and-forget via `Promise.resolve().then(...).catch(...)` — auto-rejects pending request if delivery fails |

### PPT Generation Fixes
| File | Fix |
|---|---|
| `toolProcessor.service.js` | Function-call error path now includes `err.message` instead of a hardcoded generic string, so the AI and user see the actual cause |
| `pptGeneration.service.js` | `statistics_strip` layout: bullets formatted as `"Label: Value"` are split on the first `:` — the left part becomes the metric label, the right part the big-number value; unlabelled bullets fall back to `"Metric N"` |
| `pptGeneration.service.js` | `timeline` layout with a single item: dot is centred at x=6.6 instead of snapping to the far-left edge (denominator was `items.length - 1 = 0`) |
| `pptGeneration.service.js` | `faq` layout: capped at 5 items (was 6) — the 6th row's bottom edge reached y=6.62, leaving only 0.33" before the footer note at y=6.95 |
| `openrouter.service.js` | Removed the duplicate `style` field from the `generate_ppt` tool schema; `theme` is now the single authoritative field (runtime still accepts `style` from the text-tag path for backwards compatibility) |
| `openrouter.service.js` | Added `leftTitle` and `rightTitle` to the slide schema so the AI can populate `comparison_split` column headers |

### Dead Code Removed
| File | Fix |
|---|---|
| `callbacks.service.js` | `ApprovalHandler` stub had empty listener bodies — replaced with real event-driven logging |
| `callbacks.service.js` | `getGlobalCallbackManager()` registered no handlers — now auto-registers Logger, CostTracker, MetricsCollector |

### Security Fixes
| File | Fix |
|---|---|
| `toolProcessor.service.js` | PII leak: web search query content removed from logs; only query length logged |
| `server.js` | CORS bypass: `startsWith` replaced with exact `includes` match to prevent subdomain spoofing |
| `sanitize.js` | Whitespace collapse removed: newlines/indentation preserved for code and markdown in chat messages |
| `server.js` + `csrf.js` | CSRF middleware enabled globally for mutating authenticated requests; private-network origin bypass removed |
| `auth.controller.js` + `auth.js` | Auth moved to `httpOnly` cookie (`auth_token`) with optional bearer fallback for compatibility |
| `tokenCheck.js` | Anonymous token cap: anonymous users now get `ANONYMOUS_TOKEN_LIMIT` (default 10000) instead of unlimited spend |

### Performance Improvements
| File | Fix |
|---|---|
| `chat.routes.js` | `estimateTokens(finalReply)` deduplicated — computed once as `finalReplyTokens`, reused in two branches |
| `agentOrchestrator.service.js` | `ExecutionTracer` wired into SmartAgent: LLM dispatch and tool execution both timed and recorded |

### Cross-Chat Memory (New)
| File | Change |
|---|---|
| `memory.service.js` | Added `embedAndStoreMessage({ userId, topicId, messageId, role, content, provider })` — embeds message via `rag.service.js` and upserts into `message_embeddings` table |
| `memory.service.js` | Added `searchMemory(queryVector, userId, { excludeTopicId, topK, threshold, tokenBudget })` — calls `search_memory` Supabase RPC, formats results with token-aware trimming (600 token budget split per result) |

## Environment Variables

### Backend — required

- `JWT_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `FRONTEND_URL`

### Backend — optional

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5000` | HTTP listen port |
| `NODE_ENV` | `development` | Enables/disables dev logging |
| `SENTRY_DSN` | — | Backend error tracking |
| `ANONYMOUS_TOKEN_LIMIT` | `10000` | Token cap for unauthenticated requests |
| **AI provider keys** | | |
| `GEMINI_API_KEY` | — | Google Gemini (also used as summarization fallback) |
| `GROQ_API_KEY` | — | Groq LLaMA models |
| `MISTRAL_API_KEY` | — | Mistral AI models |
| `COHERE_API_KEY` | — | Cohere models |
| `OPENAI_API_KEY` | — | OpenAI models |
| `ANTHROPIC_API_KEY` | — | Claude models |
| `DEEPSEEK_API_KEY` | — | DeepSeek models |
| `OPENROUTER_API_KEY` | — | OpenRouter (live model catalog) |
| `TOGETHER_API_KEY` | — | Together AI (live model catalog) |
| `ANYAPI_API_KEY` | — | Generic OpenAI-compatible endpoint |
| **Dedicated summarization keys** (fall back to primary key if absent) | | |
| `GEMINI_SUMMARY_API_KEY` | — | Dedicated key for history summarization via Gemini Flash |
| `MISTRAL_SUMMARY_API_KEY` | — | Dedicated key for summarization via Mistral |
| `CEREBRAS_SUMMARY_API_KEY` | — | Summarization fallback via Cerebras Llama 3.1-8b |
| **Web search** | | |
| `EXA_API_KEY` | — | Exa search provider |
| `TAVILY_API_KEY` | — | Tavily search provider |
| `FIRECRAWL_API_KEY` | — | Firecrawl provider |
| `SERPAPI_API_KEY` | — | SerpAPI provider |
| `LANGSEARCH_API_KEY` | — | LangSearch aggregation |
| `WEB_SEARCH_TIMEOUT_MS` | `8000` | Per-provider timeout |
| `WEB_SEARCH_MAX_RESULTS` | `8` | Max results returned |
| `LANGSEARCH_FRESHNESS` | `noLimit` | LangSearch freshness filter |
| `LANGSEARCH_SUMMARY` | `true` | Include LangSearch summaries |
| **URL deep-read tuning** | | |
| `GITHUB_TOKEN` | — | Raises GitHub API rate limits for repo deep-read |
| `GITHUB_READER_MAX_FILES` | — | Max files fetched per GitHub repo |
| `GITHUB_READER_MAX_FILE_BYTES` | — | Max bytes per file in GitHub deep-read |
| `GITHUB_READER_MAX_TOTAL_CHARS` | — | Total char cap across all files |
| `SITE_READER_MAX_FILES` | — | Max files for site-specific readers |
| `SITE_READER_MAX_FILE_BYTES` | — | Max bytes per file |
| `SITE_READER_MAX_TOTAL_CHARS` | — | Total char cap |
| **Chat runtime tuning** | | |
| `CHAT_MAX_DB_QUERIES` | `12` | Max DB tool-call rounds per request |
| `CHAT_MAX_CONSECUTIVE_ZERO_RESULTS` | `4` | Bail-out after N consecutive empty tool results |
| `CHAT_TOOL_RESERVE_RATIO` | `0.15` | Fraction of token budget reserved for tool outputs |
| `CHAT_SEMANTIC_CACHE_THRESHOLD` | `0.92` | Cosine similarity threshold for semantic cache hit |

### Frontend

- `VITE_API_URL` — backend base URL (e.g. `https://multi-ai-chat-backend.vercel.app/api`)
- `VITE_SENTRY_DSN` (optional) — frontend Sentry project DSN

## Testing

### Commands

```bash
cd backend
npm test                # 243 unit tests (no real APIs)
npm run test:watch      # watch mode
npm run test:coverage   # with coverage report
npm run test:real       # 25 real integration tests (requires live .env + backend running)
npm run lint            # ESLint
npm run typecheck       # TypeScript (no emit)
```

> **Warning:** `test:real` consumes actual API tokens and may incur cost. Real-test failures can occur from provider quota/rate limits (e.g. Gemini 429 on free tier) even when application wiring is correct.

### Unit test inventory (243 tests, no real APIs)

| File | Tests | Coverage |
|---|---|---|
| `chatCleanup.test.js` | 39 | `stripToolTags` (18 patterns), `isPlaceholderOnly`, `classifyError` (8 error types) |
| `tokenBudget.test.js` | 38 | `estimateTokens`, `trimTextByTokens`, `fitMessagesToBudget`, `createPromptBudget`, `createDynamicPromptBudget`, `calculateComplexityScore`, `smartTrimContextBlock` |
| `toolProcessor-matchers.test.js` | 35 | All 13 tool tag regex matchers: SEARCH_FILES, GET_FILE, WEB_SEARCH, GENERATE_IMAGE, GENERATE_PPT, GENERATE_PDF, GENERATE_EXCEL, GENERATE_DOCX, GENERATE_CSV, GENERATE_CHART, GENERATE_HTML, GENERATE_JSON, GENERATE_MD — plus a regression guard that `[EXECUTE_CODE]` is left unhandled |
| `pptGeneration.test.js` | 23 | All 15 slide layouts, all 12 themes, single-item timeline, statistics_strip label parsing, faq 5-item cap, comparison_split headers, unknown theme/layout fallback |
| `ragHybrid.test.js` | 10 | `rerankDocsHybrid` — cosine+BM25+Jaccard+RRF, numeric critical miss, lexical gate, topK |
| `memoryHybrid.test.js` | 11 | `rerankMemoryRowsHybrid` — same hybrid scoring for cross-chat memory, role preservation |
| `sanitize.test.js` | 11 | HTML tag stripping, entity decoding, newline/whitespace preservation, XSS vectors, `sanitizeBody` middleware |
| `compress.test.js` | 11 | All 7 filler patterns, short text skip, >50% compression guard |
| `chatRuntime.config.test.js` | 13 | All 4 config values: defaults, env parsing, min/max clamping, non-numeric fallback |
| `similarity.test.js` | 8 | `jaccardSimilarity` (stop words, case, punctuation) |
| `tokenCheck.test.js` | 5 | Anonymous cap (10000), quota enforcement, 429 on exhaustion, `tokenRemaining` |
| `tokenAccounting.test.js` | 6 | API-reported vs fallback billing, zero inputs, optional fields |
| `imageGeneration.test.js` | 5 | Recraft, FLUX.2 model list validation |
| `retrieverHybrid.test.js` | 2 | `HybridRetriever` vector+BM25+Jaccard+RRF fusion, empty-result handling |
| `orchestratorBrain.test.js` | 2 | Module load, degraded result on null config |
| `toolProcessor-logic.test.js` | 5 | `buildFileContext` |
| `humanApproval.test.js` | — | Approval persist, serverless non-blocking mode, cross-instance approval |
| `toolLoop.status.test.js` | — | Tool loop status event emission |
| `chatPipeline.resultShape.test.js` | — | Pipeline return object contract |
| `urlReader.service.test.js` | — | URL extraction, SSRF guard, private host blocking |
| `webSearch.service.test.js` | — | Provider fallback chain |
| `siteReaders.service.test.js` | — | Domain-specific reader dispatch |
| `githubReader.service.test.js` | — | GitHub URL parsing and repo read |

### Integration tests (real backends — `test:real`)

| File | Tests | Coverage |
|---|---|---|
| `supabase.test.js` | 7 | Connection, table queries, RPC calls, health endpoint |
| `ai-providers.test.js` | 10 | Gemini Flash/Pro, Groq, Mistral, DeepSeek V4, OpenAI, OpenRouter |
| `chat-api.test.js` | 4 | `GET /health`, `GET /models`, anonymous `POST /stream`, SSE streaming |
| `sanitize.test.js` | 11 | `sanitizeInput` + `sanitizeBody` against real middleware |
| `toolLoop.test.js` | 2 | Real Gemini single-round dispatch, abort propagation |
| `webSearch.test.js` | 1 | Real provider-backed search, normalized result shape |

For authenticated real tests set `REAL_TEST_USERNAME` (or `TEST_USERNAME`) and `REAL_TEST_PASSWORD` (or `TEST_PASSWORD`) in `.env`.

## Artifact Cleanup

AI-generated files are stored in `uploaded_files_rag` with the `topic_id` returned by the backend in the SSE `done` event. Deleting a chat triggers explicit cleanup in `backend/controllers/history.controller.js` (deletes from `uploaded_files_rag` and `uploaded_files` by `topic_id`) before calling the `delete_topic_cascade` RPC — so artifacts are removed even if the SQL function is not deployed. The sidebar re-fetches the artifact list after deletion to keep the UI in sync.

**One-time cleanup for pre-fix orphaned generated files** — run in Supabase SQL Editor if old generated files still appear in the sidebar after deletion:

```sql
DELETE FROM uploaded_files_rag
WHERE topic_id IS NULL
  AND file_type IN ('generated','html','js','jsx','ts','tsx','css','json','xml','md','svg','py','sql','sh');
```

## Related Docs

- Implementation guide: `GUIDE.md`
- Testing guide: `TESTING.md`
- Management summary: `MANAGEMENT_PRESENTATION.md`

## Artifact Intent Model Guard (removed)

The orchestrator used to be able to block a request with `errorType: model_switch_required`
and have the client retry with `allowArtifactWithCurrentModel: true`. That gate was retired
once every model gained artifact generation through the text-tag path, and the surrounding
machinery — the SSE error fields, the frontend modal, and the `allowArtifactWithCurrentModel`
request field — has now been deleted rather than left unreachable.

## URL Read Triggering

- URL intelligence is independent of the frontend `Web` toggle.
- `Web` toggle controls `forceWebSearch` only.
- URL reading is auto-triggered when `extractUrls(finalQuery)` finds links in the message.
