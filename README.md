# Multi-AI Chat

Unified AI chat platform with authentication, file-aware chat (RAG), **real provider token streaming** (no artificial delays), token controls, and admin analytics. Now includes a **complete LangChain + LangGraph + LangSmith equivalent** framework built from scratch.

## Current Scope

- Frontend: React (`frontend/`)
- Backend: Express API (`backend/`)
- Database: Supabase PostgreSQL + `pgvector` (`database/`)
- Deployment target: Vercel (frontend + backend)

## Core Capabilities

- Model routing via `backend/config/models.js` (current configured registry)
- Live provider model discovery for `openrouter`, `together`, `anyapi`
- Primary chat endpoint: `/api/chat/stream` (SSE with real provider token streaming). `/api/chat/message` is kept only as legacy JSON compatibility.
- **Real streaming**: All 10 providers stream native tokens. No artificial `setTimeout` typewriter delays. Tool-call rounds send status events, then the final answer streams in naturally.
- **Shared pipeline**: `chatPipeline.service.js` keeps legacy JSON and streaming chat behavior aligned
- **OrchestratorBrain**: `/api/chat/stream` initializes the real custom framework runtime (graph workflow, SmartAgent, callbacks, tracing, flow dashboard, parser, retriever, and vector store) before provider streaming; covered by no-mock unit tests.
- **Deploy-safe human approvals**: approval requests persist in Supabase via `human_approvals`; API approval/rejection runs through `/api/approvals` without blocking serverless invocations.
- Authenticated chat flows
- Semantic query cache, RAG context with hybrid reranking (cosine+BM25+Jaccard), history summarization, cross-chat memory with hybrid reranking
- File upload/search integration
- Upload embedding fallback for large inputs: on provider max-context errors, upload embedding retries with smaller adaptive splits to avoid zero-vector saves.
- Generated file download/preview uses API-client routes (baseURL-aware), preventing mobile SPA fallback downloads (`index.html`).
- Web search fallback chain: `Exa -> Firecrawl -> Tavily -> SerpAPI -> LangSearch` (fallback on errors/timeouts/rate limits/empty results)
- URL intelligence (auto-triggered by links in chat text):
  - Dedicated deep readers: GitHub, GitLab, Bitbucket, StackOverflow, Notion, Confluence
  - Additional domain readers: arXiv, PubMed, Google Docs, SharePoint, Medium/Substack, YouTube, Reddit, Quora, API docs (Swagger/OpenAPI-like), Gov/Legal
  - Generic fallback: Tavily/Exa/Firecrawl extraction when site-specific readers do not return usable content
- Admin panel (users, quotas, analytics)
- Theme toggle in frontend
- Sentry integration (frontend + backend)

## AI Framework (Custom LangChain + LangGraph + LangSmith)

Complete ecosystem of 16+ microservices providing production-ready AI orchestration:

### Core Services
- **Document Loaders** — Load 40+ file formats (PDF, Word, Excel, Code, Images, Archives)
- **Text Splitters** — 4 intelligent chunking strategies (recursive, semantic, sliding window, line-based)
- **Vector Stores** — Multiple backends (PgVector, In-Memory, Hybrid) with unified interface
- **Output Parsers** — 5 types (JSON, Markdown, CSV, Regex, Composite)
- **Chains** — 6 types (Simple, Conditional, Parallel, Composer, Map, Loop)
- **Agents** — ReAct pattern with dynamic tool selection and multi-turn reasoning
- **Callbacks** — Lifecycle hooks for monitoring, cost tracking, metrics, errors

### Advanced Services
- **Retrievers** — 6 search strategies (Vector, BM25, Hybrid, Metadata, Reranker, Chained)
- **Prompt Templates** — 8 types (Basic, FewShot, Chat, Conditional, Formatted, Role, Loop, Composer)
- **Memory** — 6 in-process strategies (Buffer, Summary, Entity, TokenBuffer, Window, Combined) + cross-chat RAG memory (`embedAndStoreMessage`, `searchMemory`)
- **Graph Workflows** — DAG-based execution with conditional routing and state management
- **Human-in-the-Loop** — Approval checkpoints with state snapshots and audit trails
- **Loop Management** — Cycle control (RefinementLoop, QueryLoop, ValidationLoop, PipelineLoop)

### Orchestration & Intelligence
- **Agent Orchestrator** — SmartAgent with dynamic tool selection, auto-looping, and refinement
- **ReAct Pattern** — Structured reasoning with thought-action-observation cycles
- **Multi-Agent** — AgentOrchestrator for coordinating multiple agents

### Observability & Analysis
- **Execution Tracer** — Complete step-by-step execution tracing with hierarchical nesting; wired into Agent and SmartAgent tool/LLM calls
- **Flow Visibility** — Variable tracking, state diffing, dependency analysis
- **Flow Analyzer** — Critical path, bottleneck detection, cycle detection, parallelization opportunities
- **Flow Visualizer** — Mermaid diagrams (sequence, flowchart, state), heat maps, dependency graphs
- **Flow Debugger** — Step-through debugging with breakpoints and variable watches
- **Flow Dashboard** — Real-time metrics and performance dashboards
- **Flow Optimizer** — Automatic optimization suggestions

## Quick Start

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

```bash
cd frontend
npm install
cp .env.example .env.local
npm start
```

Frontend expects `REACT_APP_API_URL`; backend expects `JWT_SECRET`, `SUPABASE_URL`, and `SUPABASE_SERVICE_KEY` at minimum.

## Documentation

- Implementation and deployment: [GUIDE.md](./GUIDE.md)
- Testing and validation: [TESTING.md](./TESTING.md)
- Management summary: [MANAGEMENT_PRESENTATION.md](./MANAGEMENT_PRESENTATION.md)

## Frontend Chat Structure

- `frontend/src/pages/ChatPage.jsx` is now a thin container that wires the chat UI together.
- Session and stream orchestration live in `frontend/src/pages/hooks/useChatSession.js`.
- Draft/input handling lives in `frontend/src/pages/hooks/useChatComposer.js`.
- Chat UI is split into smaller components under `frontend/src/components/chat/` for messages, input controls, queue state, and upload progress.

## License

MIT
