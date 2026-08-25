# Multi-AI Chat Implementation Guide

This is the main setup and maintenance guide for the current repo state.

## Current Architecture & Deployment

- **Frontend**: React SPA in `frontend/` deployed on **Vercel (Free / Hobby Tier)** in region **Mumbai (`bom1`)**
- **Backend**: Express API in `backend/` deployed on **Vercel (Free / Hobby Tier)** in region **Mumbai (`bom1`)** with `maxDuration: 300s`
- **File Storage**: **Private Vercel Blob** (`multi-chat-upload-storage`) in **Mumbai (`bom1`)** supporting direct client uploads up to **50MB** (`@vercel/blob/client`)
- **Database**: Supabase PostgreSQL + `pgvector` in **Singapore (`ap-southeast-1`)** on **Free Tier (500MB DB Limit)** storing `blob_url` pointers rather than Base64 strings
- **System Rules**: [AGENTS.md](../AGENTS.md)

## Current Features

### Core Chat
- **14 configured AI models** across DeepSeek, Groq, Gemini, Mistral, Claude, and OpenRouter in `backend/config/models.js`
- **Live provider catalogs** for `openrouter`, `together`, and `anyapi`
- **Real provider token streaming** — all 10 providers stream native tokens via SSE. No artificial delays. Tool-call rounds send status events; the final answer streams in naturally.
- **Reasoning / Thinking mode** — per-model effort level (low/medium/high/max/xhigh) with a collapsible `ReasoningPanel` in the UI. Model chain-of-thought stored in `messages.reasoning` and shown on history reload.
- **Message timestamps & actions** — bottom-right timestamp display on sent messages and AI responses with localized 12-hour formatting and full date/time hover tooltips; left-aligned copy actions.
- **Shared pipeline** (`chatPipeline.service.js`) keeps legacy JSON and streaming chat behavior aligned
- **Temporal grounding** — current date/time/week injected into every system prompt via `temporalContext.service.js`; resolves user-saved timezone preference → browser zone → `APP_DEFAULT_TIMEZONE`
- **Authenticated chat flows** with `httpOnly` cookie auth and double-submit CSRF
- **Idle logout** — configurable via `VITE_IDLE_TIMEOUT_MINUTES` (default 30); shared across tabs via localStorage

### Knowledge Base (RAG 2.0) — New
Full knowledge management system at `/knowledge`:
- Create and manage named **Knowledge Collections** (private or public workspace-wide)
- Ingest documents from **file upload**, **web crawl** (depth-limited BFS), or **raw text/markdown**
- Vision extraction at ingest: images in PDFs/Office files are extracted to text (free-first: Mistral Small → Gemini Flash-Lite)
- PDF OCR fallback: scanned PDFs fall through to Mistral OCR → OpenRouter chat model when `pdf-parse` returns too little text
- **RAPTOR summary trees**: hierarchical k-means cluster → LLM summarize at multiple abstraction levels; build via CLI (`backend/scripts/build-raptor-tree.js`) — not during upload (Vercel timeout)
- **GraphRAG**: LLM extracts entities and relations per chunk; graph traversal contributes a third candidate list at query time; build via CLI (`backend/scripts/build-knowledge-graph.js`)
- **Inspect Chunks** UI: view how a document was split, token counts, section headings
- Search (RAG 2.0): multi-query expansion + HyDE (optional) + dense + sparse (FTS/inverted index) + GraphRAG + RRF fusion + Cohere cross-encoder reranking

### RAG & Context
- **Chat-upload RAG** (existing): hybrid reranking cosine+BM25+Jaccard+RRF for per-topic uploaded files
- **Cross-chat memory** (`accurate` mode): `embedAndStoreMessage` / `searchMemory` in `memory.service.js`; stored in `message_embeddings`, searched via `search_memory` Supabase RPC; 600 token budget
- **Semantic cache** (pgvector cosine ≥ 0.92); exact cache disabled to prevent stale answers
- **URL intelligence** (auto-triggered by links, independent of Web toggle): dedicated readers for GitHub/GitLab/Bitbucket/StackOverflow, Notion/Confluence, arXiv, PubMed, Google Docs, SharePoint, Medium/Substack, YouTube, Reddit, Quora, Gov/Legal; generic fallback via Firecrawl/Tavily/Exa
- **Web search** (user-toggled, per-chat): `Exa → Firecrawl → Tavily → SerpAPI` + always LangSearch
- Upload embedding retry: on provider max-context errors, adaptive chunk splits are retried

### Human-in-the-Loop
- All 10 `GENERATE_*` tools are gated by inline approval (Yes / Other / No)
- Approval requests persist in Supabase (`human_approvals`) — serverless-safe polling
- "Other" path: user types instructions → AI revises plan → fresh approval prompt
- IDOR fix: each approval row is now scoped to `user_id` (non-admin users can only respond to their own)
- Approval timeout: 2 minutes auto-reject; hard cap 1 hour

### Infrastructure
- **Serverless-safe rate limiting**: `express-rate-limit` with `rateLimitStore.service.js` (Supabase `rate_limit_counters`)
- **Brute-force lockout**: `login_attempt_counters` table; auth controller checks `locked_until`
- **Embedding spaces**: vectors are tagged by model identity (`openai-te3-small`, `gemini-embed-001`, `mistral-embed`); all search RPCs filter by space; failover never crosses a space boundary
- **AI call timeout**: `AI_CALL_TIMEOUT_MS` (default 120s) caps any single provider call
- **Tool loop time budget**: `CHAT_TIME_BUDGET_MS` (default 240s) stops the loop from starting a new round near the Vercel function limit
- Token quotas, admin panel, analytics, Sentry (frontend + backend), theme toggle

---

## Project Layout

```
multi-ai-chat/
├── backend/
│   ├── server.js               ← entry point
│   ├── config/                 ← models, embedding, chatRuntime, supabase, sentry
│   ├── routes/                 ← auth, chat, admin, approval, history, upload, knowledge
│   ├── controllers/            ← auth, chat, admin, history, approval
│   ├── middleware/              ← auth, csrf, sanitize, tokenCheck, sentryContext
│   ├── services/               ← all business logic (52 service modules across services, ai, tools)
│   │   ├── ai/                 ← 10 provider modules + dispatcher + reasoning
│   │   └── tools/              ← webSearch, urlReader, githubReader, siteReaders
│   ├── utils/                  ← authCookie, cookies
│   ├── scripts/                ← build-raptor-tree, build-knowledge-graph, reindex-collection
│   └── __tests__/              ← 46 test files (44 unit, 2 integration, 8 real integration)
├── frontend/
│   ├── src/
│   │   ├── App.jsx             ← router (login, chat, knowledge, admin)
│   │   ├── pages/              ← LoginPage, ChatPage, KnowledgePage, AdminPage
│   │   ├── pages/hooks/        ← useChatComposer, useChatSession
│   │   ├── components/chat/    ← all chat UI components (ApprovalPrompt, ReasoningPanel, etc.)
│   │   ├── components/layout/  ← ThemeToggle, Toast, TokenBar
│   │   ├── components/admin/   ← UserModal
│   │   ├── context/            ← AuthContext, ThemeContext
│   │   ├── hooks/              ← useIdleLogout
│   │   └── utils/              ← sse (with unit tests), sessionBroadcast
├── database/                   ← schema.sql, schema_export.sql, 17 migration files + token_optimization
├── e2e/                        ← mock Playwright tests (17 tests across 5 spec files)
├── e2e-real/                   ← real Playwright tests (17 tests across 5 spec files)
└── docs/                       ← this directory
```

---

## Environment Variables

### Backend — Required

- `PORT`
- `FRONTEND_URL`
- `NODE_ENV`
- `JWT_SECRET` (≥32 chars)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `DEEPSEEK_API_KEY` — **Required for the default model** (`deepseek-v4-flash`)

### Backend — Common Optional

```
# AI providers
GEMINI_API_KEY        GROQ_API_KEY        MISTRAL_API_KEY
COHERE_API_KEY        OPENAI_API_KEY      ANTHROPIC_API_KEY
OPENROUTER_API_KEY    TOGETHER_API_KEY    ANYAPI_API_KEY

# Web search
EXA_API_KEY  TAVILY_API_KEY  FIRECRAWL_API_KEY  SERPAPI_API_KEY  LANGSEARCH_API_KEY

# Dedicated background keys (fall back to primary if absent)
GEMINI_SUMMARY_API_KEY  MISTRAL_SUMMARY_API_KEY  CEREBRAS_SUMMARY_API_KEY

# Chat runtime (see chatRuntime.config.js for full list with defaults)
CHAT_TIME_BUDGET_MS=240000   AI_CALL_TIMEOUT_MS=120000
CHAT_MAX_DB_QUERIES=12       ENABLE_ORCHESTRATOR_BRAIN=false

# Temporal grounding
APP_DEFAULT_TIMEZONE=UTC     TEMPORAL_PRECISION_MS=60000

# Knowledge Base / RAG 2.0
RAG_RERANK_ENABLED=true      COHERE_RERANK_MODEL=rerank-v3.5
RAG_QUERY_EXPANSION_ENABLED=true   RAG_HYDE_ENABLED=false
RAPTOR_ENABLED=true          GRAPHRAG_ENABLED=true

# Vision extraction (ingest)
VISION_PREFER_FREE=true      VISION_FREE_MODEL=mistral-small-latest
VISION_MODEL=google/gemini-2.5-flash-lite

# PDF OCR
PDF_OCR_ENABLED=true         PDF_OCR_MODEL=mistral-ocr-latest
```

### Frontend

- `VITE_API_URL` — backend base URL
- `VITE_SENTRY_DSN` — optional Sentry project DSN
- `VITE_IDLE_TIMEOUT_MINUTES` — idle logout timeout (default 30)

---

## Local Setup

### Option A: Monorepo Root (Recommended)
```bash
npm run install:all
npm run dev
```

### Option B: Individual Folders
1. Install backend dependencies: `cd backend && npm install`
2. Install frontend dependencies: `cd ../frontend && npm install`
3. Copy `backend/.env.example` to `backend/.env` and fill values
4. Copy `frontend/.env.example` to `frontend/.env.local`
5. Run database migrations in Supabase SQL Editor (see Database Migrations section)
6. Start backend: `cd backend && npm run dev`
7. Start frontend: `cd frontend && npm start`

---

## Database Migrations

Apply in order in the Supabase SQL Editor. All are idempotent unless noted.

**Core (required):**
1. `database/schema.sql` — base schema
2. `database/token_optimization.sql`
3. `database/migration_add_message_embeddings.sql` — cross-chat memory
4. `database/migration_add_locked_until.sql` — brute-force lockout
5. `database/migration_add_human_approvals.sql` — approval table
6. `database/migration_delete_topic_cascade.sql` — cascade deletion for topics
7. `database/migration_delete_user_cascade.sql` — cascade deletion for users
8. `database/migration_drop_sessions.sql` — drops legacy sessions table
9. `database/migration_add_generated_files_to_messages.sql` — generated files array

**New (apply for full feature set):**
10. `database/migration_add_rag2_knowledge_management.sql` — Knowledge Base tables
11. `database/migration_add_knowledge_fts.sql` — sparse FTS index
12. `database/migration_add_knowledge_graph.sql` — GraphRAG tables
13. `database/migration_add_rate_limiting.sql` — serverless rate limiting
14. `database/migration_add_reasoning_to_messages.sql` — chain-of-thought storage
15. `database/migration_add_user_timezone.sql` — per-user timezone
16. `database/migration_add_embedding_space.sql` — space-tagged vectors
17. `database/migration_add_admin_analytics.sql` — `get_admin_analytics()` SQL function
18. `database/migration_add_approval_user_scope.sql` — IDOR fix on approvals
19. `database/migration_enable_rls_all_tables.sql` — row-level security

---

## Deployment (Vercel)

### Backend

1. Deploy `backend/` to Vercel.
2. Set all required env vars in Vercel project settings.
3. Ensure `FRONTEND_URL` matches the frontend deployment URL exactly.
4. Set `trust proxy` is already configured in `server.js` — no Vercel config needed.
5. Redeploy after env changes.

### Frontend

1. Deploy `frontend/` to Vercel.
2. Set `VITE_API_URL` to the backend `/api` URL (e.g. `https://multi-ai-chat-backend.vercel.app/api`).
3. Set `VITE_SENTRY_DSN` if Sentry is enabled.
4. Redeploy after env changes.

---

## Building Knowledge Base Features

### RAPTOR Trees (CLI)

RAPTOR is built offline — Vercel's function timeout is too short for summarizing large documents.

```bash
# List documents and their build status
node backend/scripts/build-raptor-tree.js --list

# Dry-run (shows what would be built)
node backend/scripts/build-raptor-tree.js --all --dry-run

# Build all pending trees
node backend/scripts/build-raptor-tree.js --all
```

### GraphRAG (CLI)

One LLM call per chunk — check `--dry-run` before running on a large corpus.

```bash
node backend/scripts/build-knowledge-graph.js --list
node backend/scripts/build-knowledge-graph.js --all --dry-run
node backend/scripts/build-knowledge-graph.js --all
```

### Reindex a Collection

If you change the embedding provider for a collection:

```bash
node backend/scripts/reindex-collection.js --collection <id>
```

---

## Common Change Points

- **Add or change models**: `backend/config/models.js`
- **Add provider catalogs**: `backend/services/modelCatalog.service.js`
- **Adjust chat behavior**: `backend/controllers/chat.controller.js`, `backend/routes/chat.routes.js`
- **Tune token budgeting**: `backend/services/tokenBudget.service.js`
- **Hybrid reranking weights** (chat RAG): `rerankDocsHybrid` in `rag.service.js` and `rerankMemoryRowsHybrid` in `memory.service.js` — 55% cosine, 30% BM25, 15% Jaccard, +0.1 numeric boost
- **KB retrieval tuning**: `rag2.service.js` — RAG2_MATCH_THRESHOLD, RRF_K, parent window size
- **Temporal context**: `temporalContext.service.js` — `resolveTimeZone()` priority, `buildTemporalContext()` fields
- **History/summary behavior**: `context.service.js`, `summary.service.js`
- **Theme**: `frontend/src/context/ThemeContext.jsx`, `frontend/src/index.css`
- **Add a new GENERATE tool**: add regex matcher in `toolProcessor.service.js`, add intent in `chatPipeline.service.js` `ARTIFACT_INTENTS`, create `*Generation.service.js`
- **Cross-chat memory**: `embedAndStoreMessage` / `searchMemory` in `memory.service.js`. Requires `migration_add_message_embeddings.sql` and `search_memory` RPC.

---

## Artifact Cleanup

AI-generated files are stored in `uploaded_files_rag` with the `topic_id` returned by the backend in the SSE `done` event. Deleting a chat triggers explicit cleanup in `backend/controllers/history.controller.js` before calling `delete_topic_cascade`, so artifacts are removed even if the SQL function is not deployed.

**One-time cleanup for pre-fix orphans** — run in Supabase SQL Editor:
```sql
DELETE FROM uploaded_files_rag
WHERE topic_id IS NULL
  AND file_type IN ('generated','html','js','jsx','ts','tsx','css','json','xml','md','svg','py','sql','sh');
```

---

## Verification Checklist

- [ ] Backend boots without missing env errors (`npm run dev`)
- [ ] `/api/health` returns `{ status: "OK", database: "connected" }`
- [ ] Login, chat, `/knowledge`, and `/admin` routes render
- [ ] Model picker loads both static and live provider models
- [ ] Reasoning/Thinking toggle appears for supported models
- [ ] File upload, cache, RAG, and token accounting work
- [ ] Knowledge Base: create collection → upload/crawl → ask a question → citation appears
- [ ] Approval flow: ask for a GENERATE → approval prompt shows → approve → file generated
- [ ] Theme toggle persists after refresh
- [ ] Delete a chat → artifact disappears from sidebar immediately
- [ ] Idle logout fires after configured timeout
