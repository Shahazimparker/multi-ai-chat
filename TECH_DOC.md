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
- `backend/services/orchestratorBrain.service.js` wires the custom framework into `/api/chat/stream`: `GraphBuilder`, `SmartAgent`, `AgentOrchestrator`, callbacks, `ExecutionTracer`, flow dashboard/optimizer, output parser, in-memory vector store, and hybrid retriever run as a real pre-stream planning layer and emit `framework_status` SSE events. Tests use the real model registry and real framework classes without `vi.mock`.
- Human approvals are deploy-safe: `backend/services/humanApproval.service.js` supports persistent Supabase-backed requests and non-blocking serverless mode; `backend/routes/approval.routes.js` exposes admin approve/reject APIs; schema lives in `database/migration_add_human_approvals.sql`.
- Providers with streaming support: OpenAI, Groq, Claude, Gemini, Mistral, Cohere, DeepSeek, OpenRouter, Together, AnyAPI — all 10 providers.

### Core services (Existing)

- Chat orchestration: `backend/services/chat.service.js`
- Context and memory: `backend/services/context.service.js`, `backend/services/memory.service.js`, `backend/services/summary.service.js`
  - `memory.service.js` now exports `embedAndStoreMessage` and `searchMemory` for RAG-based cross-chat memory (accurate mode only)
  - Cross-chat memory persisted in `message_embeddings` table; searched via `search_memory` Supabase RPC
  - Memory context trimmed with token-budget-aware `trimTextByTokens` (600 token fixed budget, split evenly across results)
- RAG and embeddings: `backend/services/rag.service.js` (hybrid reranking: cosine+BM25+Jaccard with numeric critical miss protection)
- File pipeline: `backend/services/fileUpload.service.js`
  - Upload embeddings include max-context recovery: `EMBED_INPUT_TOO_LONG` from `rag.service.js` triggers smaller chunk retries and adaptive hard split fallback in `fileUpload.service.js`.
- Cache: `backend/services/cache.service.js`
  - Exact cache reads are disabled for live chat to avoid stale answers; successful responses can still be stored for semantic/RAG-aware reuse.
  - Semantic cache (`getSemanticCachedResponse`, pgvector cosine ≥ 0.92) remains active when RAG provides embeddings.
- Token budgeting: `backend/services/tokenBudget.service.js`
- Analytics: `backend/services/analytics.service.js`
- Similarity and compression: `backend/services/similarity.service.js`, `backend/services/compress.service.js`
- Tool execution helpers: `backend/services/tools/webSearch.service.js`, `backend/services/tools/codeExecute.service.js`
  - `webSearch.service.js` uses provider fallback in this order: `Exa -> Firecrawl -> Tavily -> SerpAPI -> LangSearch` and falls back on errors, timeouts, rate limits, or empty results.
- URL reading helpers:
  - `backend/services/tools/urlReader.service.js` — extracts/validates URLs from user query and injects URL context
  - `backend/services/tools/githubReader.service.js` — GitHub repo deep-read (tree + raw file content with limits)
  - `backend/services/tools/siteReaders.service.js` — site-specific readers for GitLab, Bitbucket, StackOverflow, Notion, Confluence, arXiv, PubMed, Google Docs, SharePoint, Medium/Substack, YouTube, Reddit, Quora, API docs, Gov/Legal
  - Runtime order: site-specific reader first, then generic provider fallback (Firecrawl/Tavily/Exa)
  - `backend/services/tools/rerank.service.js` exists but is currently not wired in runtime paths.
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
- `memory.service.js` — 6 in-process memory strategies (Buffer, Summary, Entity, TokenBuffer, Window, Combined) + `embedAndStoreMessage` + `searchMemory` with hybrid reranking (cosine+BM25+Jaccard) for cross-chat RAG memory
- `loopManagement.service.js` — 4 loop patterns (RefinementLoop, QueryLoop, ValidationLoop, PipelineLoop)

**Observability & Control:**
- `callbacks.service.js` — Event-driven lifecycle hooks for monitoring; global manager auto-initializes Logger, CostTracker, MetricsCollector on first use; ApprovalHandler wired to approval lifecycle events
- `humanApproval.service.js` — Approval checkpoints with state snapshots; timeout clamped to 1-hour hard cap; approvalFn fire-and-forget with auto-reject on notification failure
- `executionTracer.service.js` — Complete step-by-step execution tracing with TTL+LRU eviction (100 trace cap, 1-hour TTL); wired into Agent (`agent.service.js`) and SmartAgent (`agentOrchestrator.service.js`) tool/LLM calls via optional `tracer` constructor option
- `flowVisibility.service.js` — Variable tracking, state diffing, flow analysis and visualization

**Central Export:**
- `chat.service.js` — Centralized export point for all 16+ AI framework services

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
  - ERP sample/schema assets under `database/`

> **Note:** `schema.sql` and `schema_export.sql` differ on `uploaded_files_rag.topic_id`: the local schema says `ON DELETE SET NULL`; the actual deployed constraint is `ON DELETE CASCADE`. Always check `schema_export.sql` for live FK behavior.

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
| `chat.service.js` | PII leak: web search query content removed from logs; only query length logged |
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

### Backend minimum

- `JWT_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `FRONTEND_URL`

### Backend optional/common

- `SENTRY_DSN`
- `ANONYMOUS_TOKEN_LIMIT` — token cap for anonymous users (default: 10000)
- Provider API keys used by configured or optional provider modules
- Web search provider keys: `EXA_API_KEY`, `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`, `SERPAPI_API_KEY`, `LANGSEARCH_API_KEY`
- Web search optional tuning: `WEB_SEARCH_TIMEOUT_MS`, `LANGSEARCH_FRESHNESS`, `LANGSEARCH_SUMMARY`
- URL deep-read optional tuning:
  - `GITHUB_TOKEN`
  - `GITHUB_READER_MAX_FILES`, `GITHUB_READER_MAX_FILE_BYTES`, `GITHUB_READER_MAX_TOTAL_CHARS`
  - `SITE_READER_MAX_FILES`, `SITE_READER_MAX_FILE_BYTES`, `SITE_READER_MAX_TOTAL_CHARS`

### Frontend

- `REACT_APP_API_URL`
- `REACT_APP_SENTRY_DSN` (optional)

## Testing Reality

- Backend scripts exist in `backend/package.json`: `test`, `test:coverage`, `test:real`, `typecheck`, and `lint`
- Frontend test command exists (`react-scripts test`)
- Real integration tests include live web search coverage in `backend/__tests__/integration-real/webSearch.test.js`

## Related Docs

- Implementation guide: `GUIDE.md`
- Testing guide: `TESTING.md`
- Management summary: `MANAGEMENT_PRESENTATION.md`
## Artifact Intent Model Guard

- For artifact intents (`artifact_ppt`, `artifact_other`), orchestrator can require model switch via `errorType: model_switch_required`.
- SSE error payload includes `suggestedModels`, `recommendedModelId`, and `failedModelId`.
- Client can explicitly override by resending with `allowArtifactWithCurrentModel: true` to continue with the currently selected model.

## URL Read Triggering

- URL intelligence is independent of the frontend `Web` toggle.
- `Web` toggle controls `forceWebSearch` only.
- URL reading is auto-triggered when `extractUrls(finalQuery)` finds links in the message.
