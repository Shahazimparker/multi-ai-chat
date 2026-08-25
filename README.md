# Multi-AI Chat

Unified AI chat platform with authentication, real provider token streaming, reasoning model support, Knowledge Base (RAG 2.0), file-aware chat, human-in-the-loop approvals, token controls, and admin analytics.

## Current Scope & Deployment Environment

- **Frontend**: React SPA (`frontend/`) deployed on **Vercel (Free / Hobby Tier)** in **Mumbai, India (`bom1`)**
- **Backend**: Express Serverless API (`backend/`) deployed on **Vercel (Free / Hobby Tier)** in **Mumbai, India (`bom1`)** with `maxDuration: 300s`
- **File Storage**: **Private Vercel Blob** store (`multi-chat-upload-storage`) located in **Mumbai (`bom1`)** supporting direct client uploads up to **50MB**
- **Database**: **Supabase PostgreSQL** + `pgvector` in **Singapore (`ap-southeast-1`)** on **Free Tier (500MB DB cap)** with lean `blob_url` pointer storage
- **AI Integration Context**: Full agent rules and guidelines documented in [AGENTS.md](./AGENTS.md)

## Core Capabilities

- **15 configured AI models** across DeepSeek, Groq, Gemini, Mistral, Claude, OpenRouter; plus live model discovery for `openrouter`, `together`, `anyapi`
- **Real streaming**: All 10 providers stream native tokens. No artificial delays. Tool-call rounds send status events; the final answer streams naturally.
- **Direct 50MB File Uploads**: Client-to-Vercel-Blob direct upload pipeline (`@vercel/blob/client`) completely bypassing Vercel's 4.5MB serverless edge body limit. Supports all known formats (PDF, DOCX, CSV, Excel, TXT, Logs, Code, Images, ZIP) while security-gating risky executables (`.exe`, `.dll`, `.msi`, etc.).
- **Supabase DB Quota Protection**: Raw file binaries are kept in private blob storage; only lean metadata and vector embeddings are stored in PostgreSQL to preserve the 500MB free tier quota.
- **Reasoning / Thinking mode**: per-model effort levels (low/medium/high/max/xhigh) with a collapsible thought-process panel; chain-of-thought stored in DB and reloaded from history
- **Log Diagnostics, SAP ST22 & Dynamic Web Loop**: Dedicated sectional extractor for SAP ST22 short dumps (Runtime Errors, Exception, Where Terminated, `>>>` code line, Call Stack, `SY-*` variables) + multi-tech crash classifier (Linux kernel panics, OOM, DB deadlocks) with Logdy & OpenObserve sliding-window clustering; dynamic live Web Search cross-referencing loop (`[WEB_SEARCH]` ➔ `[SEARCH_FILES]`) to verify unknown error codes against live documentation
- **Collision-Proof Storage & Zero-Orphan Cascades**: Hierarchical timestamped Vercel Blob namespacing; on-demand Blob fallback; atomic cascade deletion across all 18 PostgreSQL tables and private blob storage
- **Raw Prompt Preservation & Output Headroom**: Query compression disabled across all models to preserve raw prompt text; model context window hard caps enforced; 4,000 reserved output tokens for $\ge 32\text{k}$ models (DeepSeek, Mistral, Claude)
- **Configurable Embedding & OCR Tiers**: `DEFAULT_EMBEDDING_PROVIDER` (default `openrouter`, supports `mistral`) with cross-provider space invariants, Mistral OCR (`mistral-ocr-latest`), and Vision fallback chains
- **Temporal grounding**: current date/time/week injected into every system prompt; per-user IANA timezone preference
- **Shared pipeline** (`chatPipeline.service.js`) keeps JSON and streaming behavior aligned
- **Human-in-the-loop approvals**: all 10 `GENERATE_*` tools (PPT, Image, PDF, Excel, DOCX, CSV, Chart, HTML, JSON, Markdown) gated by inline Yes/Other/No; persisted in Supabase; IDOR-safe
- **Authenticated chat flows** with `httpOnly` cookie auth, double-submit CSRF, and idle logout
- **Serverless-safe rate limiting** via Supabase counters; brute-force lockout on failed logins
- **Semantic query cache**, RAG context with hybrid reranking (cosine+BM25+Jaccard+RRF), history summarization, cross-chat memory
- **Generated file download/preview** uses API-client routes (baseURL-aware)
- **Web search aggregation**: `Exa → Firecrawl → Tavily → SerpAPI` + LangSearch; per-chat toggle
- **URL intelligence (auto-triggered by links)**: dedicated readers for GitHub, GitLab, Bitbucket, StackOverflow, Notion, Confluence, arXiv, PubMed, Google Docs, SharePoint, Medium/Substack, YouTube, Reddit, Quora, Gov/Legal; generic fallback via Firecrawl/Tavily/Exa
- **Admin panel** (users, quotas, SQL-aggregated analytics)
- **Theme toggle & timestamps**: Light/Dark theme toggle; message timestamps pinned to bottom-right with localized 12-hour formatting and full date/time hover tooltips; mobile navigation with Knowledge Bases link
- **Sentry integration** (frontend + backend)

## Quick Start

### Option A: Monorepo Root (Recommended)

```bash
npm run install:all    # Installs root, backend, and frontend dependencies
npm run dev            # Concurrently starts backend (:5000) and frontend (:5173)
```

### Option B: Separate Terminals

```bash
# Terminal 1: Backend
cd backend
npm install
cp .env.example .env   # fill in JWT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY, DEEPSEEK_API_KEY
npm run dev
```

```bash
# Terminal 2: Frontend
cd frontend
npm install
cp .env.example .env.local   # set VITE_API_URL
npm start
```

The default model (`deepseek-v4-flash`) requires `DEEPSEEK_API_KEY`. All other provider keys are optional.

## Running Tests

```bash
npm test               # Run backend unit/integration tests + frontend unit tests
npm run e2e:mock       # Fast mock Playwright E2E tests (17 tests)
npm run e2e            # Real Playwright E2E tests against running backend
```

## Frontend Structure

- `frontend/src/App.jsx` — router: `/login`, `/chat`, `/knowledge`, `/admin`
- `frontend/src/pages/ChatPage.jsx` — thin container wiring chat hooks and components
- `frontend/src/pages/KnowledgePage.jsx` — Knowledge Base management (collections, docs, crawl, chunks)
- `frontend/src/pages/AdminPage.jsx` — user management, quotas, SQL-aggregated analytics
- `frontend/src/pages/hooks/useChatSession.js` — stream/session orchestration
- `frontend/src/pages/hooks/useChatComposer.js` — draft/input and attachment handling
- `frontend/src/hooks/useIdleLogout.js` — cross-tab idle session management
- `frontend/src/components/chat/` — ApprovalPrompt, ClarificationPrompt, ReasoningPanel, ThinkingToggle, ComposerPlusMenu, ModelSelector, UnifiedModelModal, Sidebar, MobileNav, MessageBubble, and others

## Documentation

- Implementation and deployment: [GUIDE.md](./docs/GUIDE.md)
- Technical reference: [TECH_DOC.md](./docs/TECH_DOC.md)
- Testing and validation: [TESTING.md](./docs/testing/TESTING.md)
- Management summary: [MANAGEMENT_PRESENTATION.md](./docs/MANAGEMENT_PRESENTATION.md)

## License

MIT
