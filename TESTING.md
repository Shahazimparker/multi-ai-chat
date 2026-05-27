# Multi-AI Chat Testing Guide

This is the current test reference for the repo. It reflects the live backend/frontend configuration in this workspace.

## Current Scope

- Backend: Express API with auth, chat, upload, history, admin, token checks, CSRF, Sentry, business DB helpers, caching, RAG, and provider routing.
- **AI Framework**: 16+ microservices for document loading, vector storage, retrieval, agents, chains, graphs, loops, approval gates, tracing, and flow analysis
- Frontend: React app with login, chat, anonymous mode, admin, finance dashboard, theme toggle, file upload, and unified provider model picker.
- Database: Supabase/PostgreSQL with `pgvector`, token tracking, cache, topics, messages, uploads, and business DB support.

## What To Verify First

1. `backend/server.js` boots cleanly with `JWT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and optional Sentry/business DB env vars.
2. `frontend` starts and resolves `REACT_APP_API_URL`.
3. `/api/health` responds.
4. Login works and returns a token.
5. Chat works in `/chat`, `/anonymous`, and `/finance`.

## Manual Regression Checklist

### Auth and Routing

- Valid login redirects to the main chat screen.
- Invalid or expired JWT returns `401` and does not loop on the login page.
- Admin-only routes reject non-admin users.
- Anonymous mode works without persisting chat history.

### Chat Pipeline

- `/api/chat/message` returns a response for a normal prompt.
- `/api/chat/stream` returns SSE chunks and a final `done` event.
- Semantic cache hits return quickly and report `cacheHit: true` (exact cache is disabled).
- RAG-enabled queries inject document context only when topic/file context exists.
- Cross-chat memory (`accurate` mode only): past messages from other topics surface as `## Relevant context from your past conversations` in the prompt.
- `embedAndStoreMessage` stores embeddings in `message_embeddings` table after each reply in accurate mode.
- `searchMemory` returns empty string gracefully if `message_embeddings` table or `search_memory` RPC is not deployed.
- Tool-call flows complete without hanging the stream.

### Token and Budgeting

- Token quota blocks users when `remaining <= 0`.
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
- Business DB tool loop in `backend/services/chat.service.js`
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

The backend now has an automated test suite using **Vitest** (198 tests across 13 test files). Tests run in ~3.5s with zero external dependencies (Supabase is mocked globally).

### Quick Start

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
│   ├── setup.js                          # Global mocks (Supabase, Business DB)
│   ├── unit/
│   │   ├── tokenAccounting.test.js       # Billable token calculation (6 tests)
│   │   ├── chatCleanup.test.js           # stripToolTags, isPlaceholderOnly, classifyError (39 tests)
│   │   ├── compress.test.js              # Prompt compression (11 tests)
│   │   ├── similarity.test.js            # Jaccard similarity, topic detection (13 tests)
│   │   ├── sanitize.test.js              # XSS sanitization (8 tests)
│   │   ├── tokenCheck.test.js            # Token quota middleware (5 tests)
│   │   ├── chatRuntime.config.test.js    # Env var parsing with clamping (13 tests)
│   │   ├── toolProcessor-matchers.test.js # Regex matchers for all tool tags (32 tests)
│   │   ├── toolProcessor-logic.test.js   # extractReferencedTables, formatDbResults, etc. (18 tests)
│   │   ├── tokenBudget.test.js           # estimateTokens, budgets, complexity, smartTrim (38 tests)
│   │   └── bizDbState.test.js            # reserveToolLoopBudget, buildBizDbDirective (8 tests)
│   └── integration/
│       ├── toolProcessor.test.js         # processToolCall with real tool backends (6 tests)
│       └── toolLoop.test.js              # runToolLoop module load verification (1 test)
├── vitest.config.js                      # Vitest configuration with coverage thresholds
└── setup.js                              # Global test setup (env vars, Supabase mocks)
```

### Test Coverage by Tier

#### Tier 1: Pure Logic (no external deps) — 113 tests
| Service | Tests | What's covered |
|---|---|---|
| `chatCleanup.service.js` | 39 | `stripToolTags` (all 18 patterns), `isPlaceholderOnly`, `classifyError` (all 8 types) |
| `tokenBudget.service.js` | 38 | `estimateTokens`, `trimTextByTokens`, `estimateMessagesTokens`, `fitMessagesToBudget`, `createPromptBudget`, `calculateComplexityScore`, `createDynamicPromptBudget`, `parseMemoryBlock`, `rebuildMemoryBlock`, `smartTrimContextBlock` |
| `toolProcessor-matchers` | 32 | `findSearchFileMatch`, `findGetFileMatch`, `findWebSearchMatch`, `findExecuteCodeMatch`, `findGetSchemaMatch` (7 variants), `findQueryDbMatch` (5 variants), `hasBareCloseTag` |
| `toolProcessor-logic` | 18 | `extractReferencedTables`, `buildFileContext`, `formatDbResults`, `buildFallbackDbReply` |
| `chatRuntime.config.js` | 13 | All 4 config values: defaults, env reading, min/max clamping, non-numeric fallback |
| `similarity.service.js` | 13 | `jaccardSimilarity` (stop words, case, punctuation), `isSameTopic` (thresholds, last-5 window) |
| `compress.service.js` | 11 | All 7 filler patterns, short text skip, >50% compression guard |
| `sanitize.js` | 8 | HTML tag stripping, entity decoding, whitespace collapse, XSS vectors |
| `bizDbState.service.js` | 8 | `reserveToolLoopBudget` (scaling, floors, custom ratio), `buildBizDbDirective` |
| `tokenAccounting.service.js` | 6 | Both billing paths (API-reported vs fallback), zero inputs, optional fields |
| `tokenCheck.js` | 5 | Anonymous skip, remaining tokens, 429 on exhaustion, tokenRemaining |

#### Tier 2: Integration with Mocks — 7 tests
| Service | Tests | What's covered |
|---|---|---|
| `toolProcessor.service.js` | 6 | `processToolCall` with real tool backends: SEARCH_FILES, GET_FILE, WEB_SEARCH, EXECUTE_CODE, bare close tag, no-tool-match |
| `toolLoop.service.js` | 1 | Module load verification |

### CI/CD Integration

Automated via GitHub Actions (`.github/workflows/test.yml`):
- **Triggers**: Push/PR to `main`/`master` when `backend/**` changes
- **Runs**: `npm ci` → `npm run lint` → `npm run typecheck` → `npm test`
- **Coverage thresholds**: 70% lines, 70% functions, 60% branches, 70% statements

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

### Adding New Tests

1. Create file in `backend/__tests__/unit/` or `backend/__tests__/integration/`
2. Use vitest globals (`describe`, `it`, `expect`, `vi`) — no imports needed
3. Mock external deps with `vi.mock()` at the top of the file
4. Run `npm test` to verify

### Known Limitations

- **Full toolLoop integration tests** require mocking both `dispatchToAI` and `processToolCall` simultaneously, which conflicts with the global Supabase mock in `setup.js`. These paths are covered by the manual regression checklist and the Tier 1 unit tests for `toolProcessor`.
- **Business DB tests** (`bizDbState`, `toolProcessor-logic`, `toolProcessor-matchers`) trigger a real `initBusinessDB()` call on module load, which attempts a DNS lookup for `test-biz.supabase.co`. This fails gracefully (logs a warning) and tests still pass.
- **WEB_SEARCH integration test** makes a real HTTP call to DuckDuckGo (takes ~1s). Consider mocking `searchWeb` if this becomes flaky in CI.

## Real Integration Tests (Live API/DB)

### Overview

A separate test suite that uses your **actual `.env`** file to test against real Supabase, AI providers, and the running backend. These tests verify that your configuration works end-to-end.

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
├── supabase.test.js       # Real Supabase queries (8 tests)
├── ai-providers.test.js   # Real AI provider calls (10 tests)
├── chat-api.test.js       # Real HTTP chat endpoints (5 tests)
└── business-db.test.js    # Real Business DB queries (4 tests)
```

### What Each Test Verifies

| File | Tests | What's covered |
|---|---|---|
| `supabase.test.js` | 8 | Connection, users/topics/messages/cache/analytics table queries, RPC calls, health endpoint |
| `ai-providers.test.js` | 10 | Gemini Flash/Pro, Groq Mixtral/Llama, Mistral Small/Medium, DeepSeek V4 Flash/Pro, OpenAI, OpenRouter |
| `chat-api.test.js` | 5 | GET /health, GET /models, POST /message (anonymous), POST /stream (SSE), provider catalog |
| `business-db.test.js` | 4 | Connection check, init, safe SQL query, table schema retrieval |

### Last Test Run Results (2026-05-27)

| Suite | Result | Details |
|---|---|---|
| **Supabase** | ✅ 8/8 passed | All tables accessible, RPC working |
| **AI Providers** | ⚠️ 8/10 passed | Gemini Flash, Groq (both), Mistral (both), DeepSeek (both), OpenRouter — all working. Gemini Pro: quota exceeded. OpenAI: invalid API key. |
| **Chat API** | ⚠️ 4/5 passed | Health, models (15), SSE streaming, OpenRouter catalog (355 models) — all working. Anonymous /message: 403 CSRF (expected without token). |
| **Business DB** | ✅ 4/4 passed | Connected, 28KB schema loaded, SQL queries working |
| **Total** | **24/27 (89%)** | 3 failures are config issues (Gemini Pro quota, OpenAI key, CSRF) |

### Skipped Tests

Tests for providers without API keys are automatically skipped. For example, if `ANTHROPIC_API_KEY` is not set, Claude tests will show as `SKIPPED`.

### Running Specific Real Tests

```bash
# Only Supabase tests
cd backend && npx vitest run --config vitest.real.config.js __tests__/integration-real/supabase.test.js

# Only AI provider tests
cd backend && npx vitest run --config vitest.real.config.js __tests__/integration-real/ai-providers.test.js

# Only chat API tests (requires backend running)
cd backend && npx vitest run --config vitest.real.config.js __tests__/integration-real/chat-api.test.js
```

## Test Status

- **Backend unit**: 198 automated tests via Vitest (`npm test`) — no API keys needed
- **Backend real**: 25 real integration tests (`npm run test:real`) — requires `.env` + backend running
- **Backend lint**: ESLint (`npm run lint`)
- **Backend types**: TypeScript type checking (`npm run typecheck`)
- **Frontend**: `npm run test` from `frontend` (react-scripts test)
- **CI**: GitHub Actions runs lint + typecheck + unit tests on every push/PR (real tests excluded from CI)

## Merged Checklists

The detailed checklists previously split across `TESTING_CHECKLIST.md` and `TESTING_DETAILED.md` have been consolidated here. Use this file as the single testing reference.
