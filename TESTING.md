# Multi-AI Chat Testing Guide

This is the current test reference for the repo. It reflects the live backend/frontend configuration in this workspace.

## Current Scope

- Backend: Express API with auth, chat, upload, history, admin, token checks, Sentry, caching, RAG, and provider routing.
- **AI Framework**: 16+ microservices for document loading, vector storage, retrieval, agents, chains, graphs, loops, approval gates, tracing, and flow analysis
- Frontend: React app with login, chat, anonymous mode, admin, theme toggle, file upload, and unified provider model picker.
- Database: Supabase/PostgreSQL with `pgvector`, token tracking, cache, topics, messages, uploads.

## What To Verify First

1. `backend/server.js` boots cleanly with `JWT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and optional Sentry env vars.
2. `frontend` starts and resolves `REACT_APP_API_URL`.
3. `/api/health` responds.
4. Login works and returns a token.
5. Chat works in `/chat` and `/anonymous`.

## Manual Regression Checklist

### Auth and Routing

- Valid login redirects to the main chat screen.
- Invalid or expired JWT returns `401` and does not loop on the login page.
- Admin-only routes reject non-admin users.
- Anonymous mode works without persisting chat history.

### Chat Pipeline

- `/api/chat/stream` returns real provider-token SSE chunks (no artificial `setTimeout` delays) and a final `done` event.
- Artifact model routing guard: when orchestrator returns `model_switch_required`, SSE error includes `suggestedModels` and `recommendedModelId`; if client resends with `allowArtifactWithCurrentModel: true`, request continues on the current model.
- `/api/chat/message` remains available only as legacy JSON compatibility.
- OrchestratorBrain emits `framework_status` SSE events before provider token chunks and is covered by `backend/__tests__/unit/orchestratorBrain.test.js`, which uses the real model registry and real framework classes without mocks.
- Human approval deploy safety is covered by `backend/__tests__/unit/humanApproval.test.js`: approvals persist, return immediately in serverless mode, and can be approved by a separate manager instance.
- Streaming test: verify chunks arrive progressively (not all at once at the end). Each chunk should contain valid JSON with `type: 'chunk'` and a `text` field.
- Tool-call flows: during DB queries / web search, tool status events (`type: 'tool_status'`) are sent. The final answer streams in naturally after tools complete.
- Semantic cache hits return quickly and report `cacheHit: true`.
- RAG-enabled queries inject document context only when topic/file context exists.
- Cross-chat memory (`accurate` mode only): past messages from other topics surface as `## Relevant context from your past conversations` in the prompt.
- `embedAndStoreMessage` stores embeddings in `message_embeddings` table after each reply in accurate mode.
- `searchMemory` returns empty string gracefully if `message_embeddings` table or `search_memory` RPC is not deployed.
- Tool-call flows complete without hanging the stream.

### Token and Budgeting

- Token quota blocks users when `remaining <= 0`.
- Anonymous users have a token cap (`ANONYMOUS_TOKEN_LIMIT`, default 10000) instead of unlimited spend.
- Prompt budget allocation does not exceed the configured model limits.
- Billable token counts prefer provider-reported usage over local estimates.

### File Upload and Search

- Supported file types upload successfully.
- Unknown or unsupported files are handled by the fallback extractor path.
- Uploaded content can be searched from chat when RAG is enabled.
- Abort and error paths clean up temp files.

### Artifact Lifecycle and Chat Deletion

- AI generates a code/file block in an existing chat → artifact appears in the sidebar Artifacts section.
- Delete that chat → artifact disappears from the Artifacts section immediately (no page refresh needed).
- Artifact is no longer downloadable or previewable after the chat is deleted.
- Start a brand-new chat (no prior topic), send a message, AI generates a file → artifact must still be deleted when that chat is deleted (covers the `topic_id` null-at-send-time edge case).
- Uploaded files behave the same: deleting the chat removes them from artifacts.

### Provider and Model Coverage

- `backend/config/models.js` exposes the current configured models.
- `GET /api/chat/models` returns the same registry used by the frontend picker.
- `GET /api/chat/provider-models/:provider` works for `openrouter`, `together`, and `anyapi` when API keys are present.

### Admin and Analytics

- User CRUD works from the admin panel.
- Token reset and quota updates persist.
- Analytics views load without API errors.

### Theme and UX

- Theme toggle persists across reloads.
- Login, chat, and sidebar styles render correctly in both themes.
- Mobile navigation does not break the chat layout.

## AI Framework Testing Checklist

### Document & Text Processing
- DocumentLoader handles all 40+ supported file formats
- TextSplitter strategies (recursive, semantic, sliding window) work correctly
- Chunk boundaries preserve semantic meaning
- Metadata is properly preserved through processing

### Vector & Retrieval
- VectorStore backends (PgVector, In-Memory, Hybrid) work independently
- Retriever strategies return relevant results
- BM25 keyword search works alongside semantic search
- Reranker improves result relevance
- Metadata filtering works correctly

### Chains and Agents
- SimpleChain executes steps sequentially
- ConditionalChain branches correctly
- ParallelChain runs independent steps concurrently
- Agent selects appropriate tools for tasks
- SmartAgent orchestrates tool selection, looping, and refinement

### Workflows and Graphs
- Graph nodes execute in correct order
- Conditional edges route to correct targets
- Graph state propagates across nodes
- Cycle detection prevents infinite loops
- Mermaid diagram export is valid

### Loops and Refinement
- RefinementLoop improves answers iteratively
- QueryLoop retries with query refinement
- ValidationLoop fixes invalid output
- LoopBreaker exits on condition
- CycleCounter prevents infinite iterations

### Approval and Control
- ApprovalRequest creation works
- HumanApprovalHandler manages approvals
- InterruptPoints pause execution correctly
- State snapshots capture execution context
- Audit trail records all approvals

### Tracing and Visibility
- ExecutionTracer captures all steps
- Hierarchical nesting works correctly
- TraceFormatter outputs valid Mermaid diagrams
- TraceAnalyzer identifies bottlenecks
- FlowVisualizer generates clear visualizations
- FlowDebugger allows step-through debugging
- State tracking captures variable changes
- Cost and token accounting is accurate
- ExecutionTracer wired into Agent and SmartAgent: tool execution duration and LLM token counts recorded per step
- Tracer evicts stale traces after 1 hour and caps at 100 concurrent traces (no memory leak)

### Cross-Chat Memory
- `embedAndStoreMessage` upserts into `message_embeddings` without duplicates (`message_id` conflict key)
- `searchMemory` excludes current topic (already in conversation history)
- Memory context block capped at 600 tokens total, split evenly across results via `trimTextByTokens`
- Both functions return gracefully (0 / empty string) on any DB or embedding failure — chat is never blocked

## Current High-Risk Areas

- SSE stream handling in `backend/routes/chat.routes.js`
- Token accounting in `backend/controllers/chat.controller.js`
- RAG and semantic cache integration in `backend/services/rag.service.js` and `backend/services/cache.service.js`
- Provider catalog loading in `backend/services/modelCatalog.service.js`
- Agent orchestration and tool selection in `agentOrchestrator.service.js`
- Graph execution engine in `graphWorkflow.service.js`
- Execution tracing overhead under load in `executionTracer.service.js`
- Flow analysis cycle detection in `flowVisibility.service.js`
- Cross-chat memory embedding token cost in accurate mode (each message triggers `embedText` call; mitigated by LRU embedding cache)
- `search_memory` RPC and `message_embeddings` table must be deployed via `migration_add_message_embeddings.sql` for accurate mode to work
- Artifact cleanup on topic deletion — `delete_topic_cascade` may not be deployed in all environments; the controller now does an explicit pre-delete as a safety net (`backend/controllers/history.controller.js`)
- AI-generated file `topic_id` association — files must be saved after the stream `done` event so the backend-assigned `topic_id` is available (`frontend/src/pages/hooks/useChatSession.js`)

## Automated Testing (Vitest)

### Overview

The backend now has an automated test suite using **Vitest**. Unit/integration tests include mocked seams where isolation is required, and `integration-real` tests run against a live backend/services with no mocks.


```bash
cd backend
npm test              # Run all tests once
npm run test:watch    # Watch mode — re-runs on file changes
npm run test:coverage # Run with coverage report
```

### Test Architecture

```
backend/
├── __tests__/
│   ├── setup.js                          # Global test setup (env vars)
│   ├── unit/
│   │   ├── tokenAccounting.test.js       # Billable token calculation (6 tests)
│   │   ├── chatCleanup.test.js           # stripToolTags, isPlaceholderOnly, classifyError (39 tests)
│   │   ├── compress.test.js              # Prompt compression (11 tests)
│   │   ├── similarity.test.js            # Jaccard similarity (8 tests)
│   │   ├── sanitize.test.js              # XSS sanitization (8 tests)
│   │   ├── tokenCheck.test.js            # Token quota middleware (5 tests)
│   │   ├── chatRuntime.config.test.js    # Env var parsing with clamping (13 tests)
│   │   ├── toolProcessor-matchers.test.js # Regex matchers for all tool tags (36 tests)
│   │   ├── toolProcessor-logic.test.js   # buildFileContext (5 tests)
│   │   ├── tokenBudget.test.js           # estimateTokens, budgets, complexity, smartTrim (38 tests)
│   │   ├── imageGeneration.test.js       # Model list validation (4 tests, 1 skipped)
│   │   ├── orchestratorBrain.test.js     # Module load + degraded config (2 tests)
│   │   ├── pptGeneration.test.js         # Real PPTX generation with DB save (3 tests)
│   └── integration/
│       ├── toolProcessor.test.js         # processToolCall with real tool backends (17 tests)
│       └── toolLoop.test.js              # runToolLoop module load verification (1 test)
├── vitest.config.js                      # Vitest configuration with coverage thresholds
└── setup.js                              # Global test setup (env vars)
```

### Test Coverage by Tier

#### Tier 1: Pure Logic (no external deps) — 171 tests
| Service | Tests | What's covered |
|---|---|---|
| `chatCleanup.service.js` | 39 | `stripToolTags` (all 18 patterns), `isPlaceholderOnly`, `classifyError` (all 8 types) |
| `tokenBudget.service.js` | 38 | `estimateTokens`, `trimTextByTokens`, `estimateMessagesTokens`, `fitMessagesToBudget`, `createPromptBudget`, `calculateComplexityScore`, `createDynamicPromptBudget`, `parseMemoryBlock`, `rebuildMemoryBlock`, `smartTrimContextBlock` |
| `toolProcessor-matchers` | 36 | All 13 remaining tool tag matchers: SEARCH_FILES, GET_FILE, WEB_SEARCH, EXECUTE_CODE, GENERATE_IMAGE, GENERATE_PPT, GENERATE_PDF, GENERATE_EXCEL, GENERATE_DOCX, GENERATE_CSV, GENERATE_CHART, GENERATE_HTML, GENERATE_JSON, GENERATE_MD |
| `toolProcessor-logic` | 5 | `buildFileContext` |
| `chatRuntime.config.js` | 13 | All 4 config values: defaults, env reading, min/max clamping, non-numeric fallback |
| `similarity.service.js` | 8 | `jaccardSimilarity` (stop words, case, punctuation) |
| `compress.service.js` | 11 | All 7 filler patterns, short text skip, >50% compression guard |
| `sanitize.js` | 11 | HTML tag stripping, entity decoding, newline/whitespace preservation, XSS vectors, sanitizeBody middleware |
| `tokenAccounting.service.js` | 6 | Both billing paths (API-reported vs fallback), zero inputs, optional fields |
| `tokenCheck.js` | 5 | Anonymous token cap (10000), remaining tokens, 429 on exhaustion, tokenRemaining |
| `imageGeneration.service.js` | 5 | Model list validation (Recraft, FLUX.2) — 4 active, 1 skipped |
| `pptGeneration.service.js` | 3 | Real PPTX generation with DB save, subtitle option, safe filename |
| `orchestratorBrain.service.js` | 2 | Module load check + degraded result on null config |
| `ragHybrid.test.js` | 10 | `rerankDocsHybrid` — cosine+BM25+Jaccard hybrid reranking, numeric critical miss, lexical gate, topK |
| `memoryHybrid.test.js` | 11 | `rerankMemoryRowsHybrid` — same hybrid scoring for cross-chat memory, role preservation |

#### Tier 2: Integration with Real Backends — 18 tests
| Service | Tests | What's covered |
|---|---|---|
| `toolProcessor.service.js` | 17 | `processToolCall` with real backends: SEARCH_FILES, GET_FILE, WEB_SEARCH, EXECUTE_CODE, GENERATE_PPT, GENERATE_PDF, GENERATE_EXCEL, GENERATE_DOCX, GENERATE_CSV, GENERATE_CHART, GENERATE_HTML, GENERATE_JSON, GENERATE_MD, no-tool-match, invalid JSON, empty slides |
| `toolLoop.service.js` | 1 | Module load verification |


### Running Tests Locally

```bash
# All tests
cd backend && npm test

# Watch mode (re-runs on save)
cd backend && npm run test:watch

# With coverage
cd backend && npm run test:coverage

# Single file
cd backend && npx vitest run __tests__/unit/tokenAccounting.test.js
```

### Real Integration Notes

- Run real tests with: `cd backend && npm run test:real`
- Real CSRF/auth test file: `backend/__tests__/integration-real/csrf-auth.test.js`
- For authenticated real tests set:
  - `REAL_TEST_USERNAME` (or `TEST_USERNAME`)
  - `REAL_TEST_PASSWORD` (or `TEST_PASSWORD`)



## Real Integration Tests (Live API/DB)

### Overview

A separate test suite that uses your **actual `.env`** file to test against real Supabase, AI providers, and the running backend. These tests verify that your configuration works end-to-end. **No mocks** — every test hits real infrastructure.

**⚠️ WARNING: These tests consume real API tokens and may incur costs!**

### Quick Start

```bash
# 1. Start the backend first
cd backend && npm run dev

# 2. In another terminal, run real integration tests
cd backend && npm run test:real
```

### Test Files

```
backend/__tests__/integration-real/
├── setup.js               # Loads .env for real API keys
├── supabase.test.js       # Real Supabase queries (7 tests)
├── ai-providers.test.js   # Real AI provider calls (10 tests)
├── chat-api.test.js       # Real HTTP chat endpoints (4 tests)
├── sanitize.test.js       # Real sanitizeInput + sanitizeBody middleware (11 tests)
└── toolLoop.test.js       # Real toolLoop with Gemini dispatch (2 tests)
```

### What Each Test Verifies

| File | Tests | What's covered |
|---|---|---|
| `supabase.test.js` | 7 | Connection, users/topics/messages/cache/analytics table queries, RPC calls, health endpoint |
| `ai-providers.test.js` | 10 | Gemini Flash/Pro, Groq Mixtral/Llama, Mistral Small/Medium, DeepSeek V4 Flash/Pro, OpenAI, OpenRouter |
| `chat-api.test.js` | 4 | GET /health, GET /models, anonymous POST /stream, POST /stream (SSE) |
| `sanitize.test.js` | 11 | `sanitizeInput` HTML stripping, entities, whitespace, edge cases + `sanitizeBody` middleware |
| `toolLoop.test.js` | 2 | Real Gemini single-round dispatch, abort error propagation |



### Running Specific Real Tests

```bash
# Only Supabase tests
cd backend && npx vitest run --config vitest.real.config.js __tests__/integration-real/supabase.test.js

# Only AI provider tests
cd backend && npx vitest run --config vitest.real.config.js __tests__/integration-real/ai-providers.test.js

# Only chat API tests (requires backend running)
cd backend && npx vitest run --config vitest.real.config.js __tests__/integration-real/chat-api.test.js

# Only chat pipeline result-shape test (fast local)
cd backend && npx vitest run __tests__/unit/chatPipeline.resultShape.test.js
```

## Test Status

- **Backend unit**: 223 automated tests via Vitest (`npm test`) — requires `.env` with Supabase + API keys
- **Backend real**: 25 real integration tests (`npm run test:real`) — requires `.env` + backend running
- **Backend lint**: ESLint (`npm run lint`)
- **Backend types**: TypeScript type checking (`npm run typecheck`)
- **Frontend**: `npm run test` from `frontend` (react-scripts test)
- **CI**: GitHub Actions runs lint + typecheck + unit tests on every push/PR (real tests excluded from CI)

### Last Test Run (2026-05-31)
- **223 tests, 0 failures, 21 test files** — all passing with real Supabase + OpenRouter connections
- File generation verified: Image (Recraft v4.1), PPT, PDF, Excel, DOCX, CSV, Chart/SVG, HTML, JSON, Markdown
- Hybrid reranking verified: cosine+BM25+Jaccard with numeric critical miss protection for RAG and cross-chat memory

## Merged Checklists

The detailed checklists previously split across `TESTING_CHECKLIST.md` and `TESTING_DETAILED.md` have been consolidated here. Use this file as the single testing reference.
