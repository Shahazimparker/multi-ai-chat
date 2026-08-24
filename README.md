# Multi-AI Chat

Unified AI chat platform with authentication, real provider token streaming, reasoning model support, Knowledge Base (RAG 2.0), file-aware chat, human-in-the-loop approvals, token controls, and admin analytics.

## Current Scope

- Frontend: React (`frontend/`)
- Backend: Express API (`backend/`)
- Database: Supabase PostgreSQL + `pgvector` (`database/`)
- Deployment target: Vercel (frontend + backend)

## Core Capabilities

- **14 configured AI models** across DeepSeek, Groq, Gemini, Mistral, Claude, OpenRouter; plus live model discovery for `openrouter`, `together`, `anyapi`
- **Real streaming**: All 10 providers stream native tokens. No artificial delays. Tool-call rounds send status events; the final answer streams naturally.
- **Reasoning / Thinking mode**: per-model effort levels (low/medium/high/max/xhigh) with a collapsible thought-process panel; chain-of-thought stored in DB and reloaded from history
- **Knowledge Base (RAG 2.0)**: named collections; ingest via file upload, web crawl, or raw text; RAPTOR hierarchical summarization trees; GraphRAG entity/relation extraction; multi-query expansion; Cohere cross-encoder reranking; dense + sparse + graph retrieval fusion
- **Temporal grounding**: current date/time/week injected into every system prompt; per-user IANA timezone preference
- **Shared pipeline** (`chatPipeline.service.js`) keeps JSON and streaming behavior aligned
- **Human-in-the-loop approvals**: all 10 `GENERATE_*` tools (PPT, Image, PDF, Excel, DOCX, CSV, Chart, HTML, JSON, Markdown) gated by inline Yes/Other/No; persisted in Supabase; IDOR-safe
- Authenticated chat flows with `httpOnly` cookie auth, double-submit CSRF, and idle logout
- **Serverless-safe rate limiting** via Supabase counters; brute-force lockout on failed logins
- Semantic query cache, RAG context with hybrid reranking (cosine+BM25+Jaccard+RRF), history summarization, cross-chat memory
- File upload/search integration; ZIP safety limits; vision extraction at ingest; PDF OCR fallback
- Generated file download/preview uses API-client routes (baseURL-aware)
- Web search aggregation: `Exa → Firecrawl → Tavily → SerpAPI` + LangSearch; per-chat toggle
- URL intelligence (auto-triggered by links): dedicated readers for GitHub, GitLab, Bitbucket, StackOverflow, Notion, Confluence, arXiv, PubMed, Google Docs, SharePoint, Medium/Substack, YouTube, Reddit, Quora, Gov/Legal; generic fallback via Firecrawl/Tavily/Exa
- Admin panel (users, quotas, SQL-aggregated analytics)
- Theme toggle; mobile navigation with Knowledge Bases link
- Sentry integration (frontend + backend)

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
