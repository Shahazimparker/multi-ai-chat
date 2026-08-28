# Multi-AI Chat Testing Guide

This is the current test reference for the repo. It reflects the live backend/frontend configuration in this workspace.

## Current Scope

- **Backend**: Express API with auth (including brute-force lockout), chat streaming, file uploads, history, admin, approvals, knowledge base (RAG 2.0), token limits, CSRF, Sentry, caching, and provider routing.
- **AI Framework**: Services for document loading, vector storage, retrieval, agents, chains, graphs, approval gates, tracing, and flow analysis.
- **Knowledge Base (RAG 2.0)**: Collections, web crawl, RAPTOR trees, GraphRAG, vision extraction, PDF OCR, query expansion, Cohere cross-encoder reranking.
- **Frontend**: React app with login, chat, knowledge management, admin, theme toggle, file upload, unified provider model picker, reasoning panel, idle logout.
- **Database**: Supabase/PostgreSQL with `pgvector`, token tracking, cache, topics, messages, uploads, knowledge tables, rate limit counters.

---

## Test Commands

### Monorepo Root
```bash
npm test                # Run backend unit/integration tests + frontend unit tests
npm run test:real       # Real integration tests (requires live .env + backend running)
npm run e2e:mock        # Fast mock Playwright E2E tests (17 tests)
npm run e2e             # Real Playwright E2E tests against running backend
npm run e2e:ui          # Playwright test runner UI
```

### Backend Subfolder
```bash
cd backend
npm test                # unit and integration tests (59 test files, 846 passed, 1 skipped)
npm run test:watch      # watch mode
npm run test:coverage   # with coverage report
npm run test:real       # real integration tests (requires live .env + backend running)
npm run lint            # ESLint
npm run typecheck       # TypeScript (no emit)
```

### Frontend Subfolder
```bash
cd frontend
npm test                # frontend unit tests (vitest: sse.test.js, MessageBubble.test.jsx)
npm run test:watch      # frontend test watch mode
```

> **Warning:** `test:real` and `e2e` consume actual API tokens and may incur cost. Failures can occur from provider quota/rate limits even when application wiring is correct.

---

## What To Verify First

1. `backend/server.js` boots cleanly with `JWT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and `DEEPSEEK_API_KEY`.
2. `frontend` starts and resolves `VITE_API_URL`.
3. `/api/health` responds `{ status: "OK", database: "connected" }`.
4. Login works and issues `auth_token` cookie + `csrf_token`.
5. Chat works in `/chat`; reasoning panel shows on supported models.
6. `/knowledge` loads and shows empty collections state.

---

## Manual Regression Checklist

### Auth and Session

- Valid login redirects to chat screen.
- Invalid credentials are rejected; 5th failure triggers `locked_until` lockout.
- Locked account returns 429; unlock after lockout period.
- Expired JWT returns `401` and does not loop on login page.
- Admin-only routes reject non-admin users.
- Idle logout fires after `VITE_IDLE_TIMEOUT_MINUTES` of inactivity.
- Logging out in one tab triggers redirect in all other open tabs (cross-tab broadcast).
- Mutating requests without CSRF token are rejected with 403.

### Chat Pipeline

- `/api/chat/stream` returns real provider-token SSE chunks and a final `done` event.
- Reasoning/Thinking mode: "Thought for Ns" panel appears; collapse/expand works; reasoning stored and reloaded from history.
- `/api/chat/message` remains available as legacy JSON compatibility.
- Tool-call flows: `tool_status` events sent during DB queries / web search; final answer streams naturally.
- Semantic cache hits return quickly and report `cacheHit: true`.
- RAG-enabled queries inject document context when topic/file context exists.
- Cross-chat memory (`accurate` mode): past messages surface as `## Relevant context from your past conversations`.
- URL read works even when Web toggle is OFF; GitHub/GitLab repo URLs return repo-aware context.
- Web search toggle is per-chat, not global — does not bleed into new or other chats.
- KB collection selection is per-chat — cleared on chat switch or new chat.

### Knowledge Base (RAG 2.0)

- Create a collection (name, icon, color, public/private) → appears in list.
- Upload a file → document shows `processing → success` status; chunk count updates.
- Crawl a URL → crawl runs, pages appear as documents with "Web Crawl" source type.
- Add raw text/markdown → indexed instantly, chunk count shows.
- Inspect Chunks → chunk viewer shows text, token count, section heading.
- Delete a document → removed from list, collection doc count updates.
- Delete a collection → all documents and chunks removed.
- Attach collection in chat → response cites relevant passages with relevance score.
- Reranking: if `COHERE_API_KEY` is set, passages are ordered by cross-encoder; below `RAG_RERANK_MIN_RELEVANCE` are not shown as sources.
- RAPTOR tree: build via CLI; broad-question retrieval returns a summary node; specific-question retrieval returns a leaf chunk.
- GraphRAG: build via CLI; question mentioning an entity surfaces chunks from related passages.
- Vision extraction: upload a PDF with images → image text appears in chunk content.
- PDF OCR: upload a scanned PDF → text extracted via OCR fallback.

### Token and Budgeting

- Token quota blocks users when `remaining <= 0` (429).
- Anonymous users get `ANONYMOUS_TOKEN_LIMIT` (default 10000) cap.
- Prompt budget allocation does not exceed configured model limits.
- Billable token counts prefer provider-reported usage over local estimates.

### File Upload and Search

- Supported file types upload successfully.
- ZIP safety: entry count, uncompressed size, and per-entry size limits enforced.
- Uploaded content can be searched from chat when RAG is enabled.
- Abort and error paths clean up temp files.
- Large upload embedding: adaptive chunk fallback on provider max-context errors.

### Artifact Lifecycle

- AI generates a file → artifact appears in sidebar Artifacts section.
- Delete that chat → artifact disappears immediately (no page refresh needed).
- New chat (no prior topic) → AI generates file → deleting chat removes the artifact.
- Uploaded files: deleting chat removes them from artifacts.

### Approval Flow

- Vague generation request → clarification form shown first; no re-arming on follow-up answers.
- `approval_request` SSE arrives with correct `toolType`, `toolLabel`, and `summary`.
- Yes path: generation proceeds, file card appears in chat.
- No path: cancellation message, no file.
- Other path: user instructions → AI revises plan → fresh `approval_request` with updated summary → Yes generates revised file.
- Timeout (2 min): auto-reject; user sees cancellation message.
- IDOR: user can only respond to their own approval requests; 403 on others.

### Provider and Model Coverage

- `GET /api/chat/models` returns current registry.
- `GET /api/chat/provider-models/:provider` returns live catalog for `openrouter`, `together`, `anyapi`.
- Reasoning toggle shows/hides per model capability.

### Admin and Analytics

- User CRUD works from the admin panel.
- Token reset and quota updates persist.
- Analytics views load with correct totals (SQL-aggregated, not JS-capped at 1000 rows).
- API Status tab shows provider health.

### Theme, UX, and Mobile

- Theme toggle persists across reloads on chat, admin, knowledge, and login screens.
- Mobile viewport (390×844): no blank top bar; hamburger nav drawer includes Knowledge Bases link.
- Mobile file upload works.
- Token usage bar updates after each message.
- Generated-file downloads work on real mobile (should not download `index.html`).
- Delete-chat confirmation names the chat title.

### Security

- `<script>` / HTML payloads in chat input render as inert text (not executed).
- Artifact preview (`Sidebar.jsx` → `document.write()`) escapes HTML correctly; `<img onerror=...>` in a filename is inert.
- Auth token in `httpOnly` cookie is not readable by JavaScript.
- CSRF: POST without `X-CSRF-Token` header matching cookie is rejected.
- Rate limiter: `/api/knowledge` heavy endpoints enforce `knowledgeHeavyLimiter`; counters survive across lambda instances.

---

## Automated Testing (Vitest — Unit + Integration)

### Test Architecture

```
backend/
├── __tests__/
│   ├── setup.js                           # Global setup — loads .env but overwrites provider keys with placeholders
│   ├── unit/                              # 57 unit test files
│   │   ├── admin.controller.test.js       # Role enum, password policy, last-admin guard
│   │   ├── approval.controller.test.js    # IDOR ownership check on respondFromChat / checkStatus
│   │   ├── authLockout.test.js            # Brute-force lockout: login_attempt_counters
│   │   ├── chatCleanup.test.js            # stripToolTags (18+ patterns), classifyError (8 types)
│   │   ├── chatPipeline.resultShape.test.js # Pipeline return object contract
│   │   ├── analytics.service.test.js      # Response-cache vs prompt-cache separation; unapplied-migration fallback
│   │   ├── chatRuntime.config.test.js     # All env var parsing with clamping
│   │   ├── contextWindow.test.js          # Measure-and-evict: fits-untouched, eviction order, hysteresis, cache-stable prefix
│   │   ├── promptCache.test.js            # Provider cache dialects, Anthropic history breakpoint, cache key
│   │   ├── promptCacheKey.wiring.test.js  # Mistral prompt_cache_key is actually sent (silent-failure guard)
│   │   ├── compress.test.js               # Prompt compression
│   │   ├── csrf.test.js                   # Double-submit CSRF header/cookie check
│   │   ├── dispatcherTimeout.test.js      # AI_CALL_TIMEOUT_MS deadline enforcement
│   │   ├── embeddingSpace.test.js         # Space resolution, failover, padding
│   │   ├── fileUpload.zip.test.js         # ZIP entry count, uncompressed size limits
│   │   ├── geminiHistory.test.js          # buildGeminiHistory — drops system turns
│   │   ├── githubReader.service.test.js   # GitHub URL parsing and repo read
│   │   ├── history.controller.test.js     # renameTopic 404 on empty update
│   │   ├── humanApproval.sweeper.test.js  # Process-wide WeakRef sweeper (memory leak guard)
│   │   ├── humanApproval.test.js          # Approval persist, serverless mode, cross-instance
│   │   ├── imageGeneration.test.js        # Model list validation (Recraft, FLUX.2)
│   │   ├── knowledgeGraph.test.js         # GraphRAG entity/relation extraction, no hallucinated edges
│   │   ├── memoryHybrid.test.js           # rerankMemoryRowsHybrid — cross-chat memory
│   │   ├── orchestratorBrain.test.js      # Module load + degraded config
│   │   ├── pdfOcr.test.js                 # PDF OCR: text layer first, OCR only when needed
│   │   ├── pptGeneration.test.js          # All 15 layouts, all 20 themes, edge cases
│   │   ├── queryTransform.test.js         # Multi-query expansion + HyDE; original query always preserved
│   │   ├── rag2.test.js                   # RAG 2.0: ingest, search, crawler helpers
│   │   ├── ragHybrid.test.js              # rerankDocsHybrid — cosine+BM25+Jaccard+RRF
│   │   ├── raptor.test.js                 # RAPTOR tree: deterministic clustering, summary penalty
│   │   ├── rateLimitStore.test.js         # SupabaseRateLimitStore fresh instance per call
│   │   ├── rerank.test.js                 # Cohere cross-encoder reranking, fallback on outage
│   │   ├── fileTools.test.js              # ANALYZE_TABLE / READ_ROWS / COMPARE_FILES wiring + cross-tool coordinate composition
│   │   ├── logTemplateMiner.test.js       # Drain templating, rare events, burst detection, explicit-level severity
│   │   ├── storageParity.test.js          # Blob vs DB-base64 routes must yield identical text and identical tool output
│   │   ├── tabularProfiler.test.js        # Census, percentiles, pt-fingerprint parity, guessed-column downgrade
│   │   ├── tableCensus.test.js            # describeTable/analyzeTable on files matching no header vocabulary
│   │   ├── rerankFiles.test.js            # Cohere rerank for uploaded files/logs with 429 resilience
│   │   ├── retrieverHybrid.test.js        # HybridRetriever RRF fusion
│   │   ├── sanitize.test.js               # XSS sanitization, whitespace preservation
│   │   ├── searchKB.tool.test.js          # [SEARCH_KB] tool — loop prevention on empty results
│   │   ├── siteReaders.service.test.js    # Domain-specific reader dispatch
│   │   ├── temporalContext.test.js        # Timezone resolution, temporal block rendering
│   │   ├── testIsolation.test.js          # Guards unit suite from making real API calls
│   │   ├── tokenAccounting.test.js        # Billable token calculation
│   │   ├── tokenBudget.test.js            # estimateTokens, budgets, complexity, smartTrim
│   │   ├── tokenCheck.test.js             # Token quota middleware, anonymous cap
│   │   ├── toolLoop.status.test.js        # Tool loop status event emission
│   │   ├── toolLoop.timeBudget.test.js    # Time budget stops loop before Vercel limit
│   │   ├── toolProcessor-logic.test.js    # buildFileContext
│   │   ├── toolProcessor-matchers.test.js # All 13 tool tag regex matchers + EXECUTE_CODE guard
│   │   ├── urlReader.service.test.js      # URL extraction, SSRF guard
│   │   ├── visionExtraction.test.js       # Vision chain ordering, rate-limit cooldown, NULL on unreadable image
│   │   └── webSearch.service.test.js      # Provider fallback chain
│   ├── integration/                       # 2 integration test files
│   │   ├── toolProcessor.test.js          # processToolCall with real tool backends (22 tests)
│   │   └── toolLoop.test.js               # Module load verification
│   └── integration-real/                  # 8 real integration test files
│       ├── setup.js
│       ├── supabase.test.js               # Real Supabase queries (7 tests)
│       ├── ai-providers.test.js           # Real AI provider calls (10 tests)
│       ├── chat-api.test.js               # Real HTTP endpoints (4 tests)
│       ├── sanitize.test.js               # Real sanitizeInput + sanitizeBody (11 tests)
│       ├── toolLoop.test.js               # Real Gemini dispatch + abort (2 tests)
│       ├── webSearch.test.js              # Real provider-backed search (1 test)
│       ├── approval-flow.test.js          # Real approval lifecycle (SSE + respond)
│       └── csrf-auth.test.js              # CSRF + cookie auth against real backend
frontend/
├── src/utils/sse.test.js                  # SSE parser unit tests (13 tests)
└── src/components/chat/MessageBubble.test.jsx # MessageBubble timestamp & footer tests (3 tests)
```

### Unit Test Coverage by Module

| Test File | What's Covered |
|---|---|
| `chatCleanup.test.js` | `stripToolTags` all patterns, `classifyError` 8 error types |
| `tokenBudget.test.js` | `estimateTokens`, `trimTextByTokens`, `fitMessagesToBudget`, `createDynamicPromptBudget`, `smartTrimContextBlock` |
| `contextWindow.test.js` | `createContextWindow`, `fitPromptToWindow` (fast path returns the same array reference so the cached prefix is untouched; eviction order; low-water hysteresis; whole-message-only history eviction), `mergeVolatileIntoQuery`, `toolLoopHeadroom` |
| `promptCache.test.js` | `extractCacheUsage` across all four provider dialects, `buildPromptCacheKey`, `applyAnthropicHistoryBreakpoint`, `describeCacheUsage` |
| `promptCacheKey.wiring.test.js` | Mistral sends `prompt_cache_key` and omits it cleanly when absent; non-streaming cache reporting. Guards a failure that is invisible in logs and responses — only the bill moves |
| `analytics.service.test.js` | `cache_hit` (response cache) stays separate from `prompt_cache_*_tokens` (provider cache); retries without the new columns when the migration is unapplied; never throws |
| `toolProcessor-matchers.test.js` | All 13 tool tag matchers + `[EXECUTE_CODE]` regression guard |
| `toolProcessor-logic.test.js` | `buildFileContext` attachment formatting and validation |
| `pptGeneration.test.js` | All 15 slide layouts, 20 themes, edge cases |
| `ragHybrid.test.js` | `rerankDocsHybrid` cosine+BM25+Jaccard+RRF |
| `memoryHybrid.test.js` | `rerankMemoryRowsHybrid` cross-chat memory |
| `retrieverHybrid.test.js` | `HybridRetriever` vector+BM25 fusion |
| `sanitize.test.js` | HTML stripping, XSS, whitespace preservation |
| `compress.test.js` | All 7 filler patterns, compression guard |
| `chatRuntime.config.test.js` | All env vars, clamping, non-numeric fallback |
| `csrf.test.js` | Header/cookie match, GET passthrough, blocked forged POST |
| `authLockout.test.js` | `login_attempt_counters`, lockout after threshold |
| `admin.controller.test.js` | Role enum, min-password policy, last-admin guard |
| `approval.controller.test.js` | IDOR ownership check |
| `history.controller.test.js` | `renameTopic` 404 on empty update |
| `humanApproval.test.js` | Persist, serverless mode, cross-instance |
| `humanApproval.sweeper.test.js` | WeakRef sweeper prevents memory leak |
| `toolLoop.timeBudget.test.js` | Loop stops before time budget is exceeded |
| `dispatcherTimeout.test.js` | `AI_CALL_TIMEOUT_MS` deadline enforcement |
| `embeddingSpace.test.js` | Space resolution, same-space failover, no cross-space |
| `rateLimitStore.test.js` | Fresh instance per call, key namespacing |
| `temporalContext.test.js` | Zone resolution priority, ISO block rendering |
| `rag2.test.js` | `ingestDocumentContent`, `searchKnowledgeCollections`, crawler helpers |
| `rerank.test.js` | Cohere API wrapper, fallback to RRF on outage |
| `tabularProfiler.test.js` | Column census, duration/unit inference, percentiles, `pt-fingerprint` parity, `GUESSED` column downgraded to `UNVERIFIED` |
| `tableCensus.test.js` | `describeTable` / `analyzeTable` on Japanese and cryptic headers — the path that does not use the header vocabulary |
| `logTemplateMiner.test.js` | Drain masking/similarity/merging, rare-event isolation, median+4×MAD bursts, explicit level beats content keywords |
| `fileTools.test.js` | Tool matchers, argument parsing, filters, and the composition test: a line number from `ANALYZE_TABLE` must resolve in `READ_ROWS` |
| `storageParity.test.js` | Vercel Blob and Base64-DB routes resolve to byte-identical text and produce identical census/analysis/row output |
| `rerankFiles.test.js` | Cohere rerank on uploaded files/logs, 429 rate-limit cooldown & non-blocking fallback |
| `raptor.test.js` | Deterministic k-means, summary penalty, primary-text wins tie |
| `knowledgeGraph.test.js` | Entity/relation extraction, no hallucinated edges |
| `queryTransform.test.js` | Multi-query expansion, HyDE, original query preserved |
| `visionExtraction.test.js` | Free-first ordering, rate-limit cooldown, NULL on unreadable |
| `pdfOcr.test.js` | Text layer first, OCR only when needed |
| `fileUpload.zip.test.js` | ZIP entry count, total size, per-entry size limits |
| `searchKB.tool.test.js` | `[SEARCH_KB]` loop prevention on empty results |
| `testIsolation.test.js` | Provider keys overwritten in setup.js — guards against live billing |

### Integration Tests (Real Backends — `test:real`)

| File | Tests | What's Covered |
|---|---|---|
| `supabase.test.js` | 7 | Connection, table queries, RPC calls, health endpoint |
| `ai-providers.test.js` | 10 | Gemini Flash/Pro, Groq, Mistral, DeepSeek V4, OpenAI, OpenRouter |
| `chat-api.test.js` | 4 | `GET /health`, `GET /models`, anonymous `POST /stream`, SSE streaming |
| `sanitize.test.js` | 11 | `sanitizeInput` HTML stripping, entities, whitespace + `sanitizeBody` middleware |
| `toolLoop.test.js` | 2 | Real Gemini dispatch, abort propagation |
| `webSearch.test.js` | 1 | Real provider-backed search, normalized result shape |
| `approval-flow.test.js` | — | Full approval lifecycle: SSE → approval_request → respond → generation |
| `csrf-auth.test.js` | — | CSRF + cookie auth: mutating request without token rejected |

For authenticated real tests set `REAL_TEST_USERNAME` and `REAL_TEST_PASSWORD` (or `TEST_USERNAME` / `TEST_PASSWORD`) in `.env`.

---

## E2E Tests (Playwright)

### Mock Tests (`e2e/`) — Fast, No Real Backend

```bash
npx playwright test
# or
npm run e2e:mock
```

| Spec | Tests | Coverage |
|---|---|---|
| `auth.spec.ts` | 4 | Login/logout, route protection, admin role redirect |
| `chat.spec.ts` | 4 | Chat message, clarification form, approval flow, new chat |
| `artifacts.spec.ts` | 3 | File upload, artifact sidebar, filter, delete |
| `admin.spec.ts` | 4 | Admin CRUD, analytics dashboard |
| `model-selector.spec.ts` | 2 | Unified model modal, reasoning/thinking level UI |

Total: **17 tests across 5 spec files**.

### Real Tests (`e2e-real/`) — Live Backend Required

```bash
$env:REAL_TEST_USERNAME = "test"
$env:REAL_TEST_PASSWORD = "Welcome@1234"
npx playwright test --config=playwright.real.config.ts
```

| Spec | Tests | Coverage |
|---|---|---|
| `auth.real.spec.ts` | 3 | Real backend login/logout, route protection, admin landing |
| `artifacts.real.spec.ts` | 2 | Real file upload, sidebar |
| `chat.real.spec.ts` | 5 | Real chat, model default, clarification, approval rejection, topic switch |
| `admin.real.spec.ts` | 2 | Admin tabs load, destructive mutations opt-in guard |
| `approval.real.spec.ts` | 5 | Full approval UI lifecycle: prompt, revision, approval, rejection, labels |

Total: **17 tests across 5 spec files**.

**Known issues:**
- JWT persistence in Playwright test context causes admin and approval tests to fail/skip
- Approval UI tests timeout at 180s (LLM generation takes 2-3 minutes); increase to 300s to fix
- Use `backend/__tests__/integration-real/approval-flow.test.js` for API-level approval verification

---

## Current High-Risk Areas

- SSE stream handling in `backend/routes/chat.routes.js`
- Token accounting in `backend/controllers/chat.controller.js`
- RAG 2.0 retrieval pipeline in `rag2.service.js` (multi-pass, multiple services)
- RAPTOR and GraphRAG build jobs: expensive, resumable, no Vercel timeout — CLI only
- Cross-encoder reranking: Cohere dependency; fallback to LLM reranker must not break retrieval
- Embedding space correctness: failover must never cross a space boundary
- Provider catalog loading in `backend/services/modelCatalog.service.js`
- `search_memory` RPC and `message_embeddings` table must be deployed for accurate memory mode
- Site-specific URL readers may return partial content on protected/paywalled pages
- Artifact cleanup on topic deletion — controller pre-delete is the safety net
- AI-generated file `topic_id` association — saved after stream `done` event in `useChatSession.js`
- Serverless rate-limit counters must be in Supabase — `MemoryStore` resets on every cold start
