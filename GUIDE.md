# Multi-AI Chat Implementation Guide

This is the main setup and maintenance guide for the current repo state.

## Current Architecture

- Frontend: React app in `frontend/`
- Backend: Express API in `backend/`
- Database: Supabase/PostgreSQL with `pgvector`
- Deployment: Vercel for frontend and backend

## Current Features

- 15 configured AI models across DeepSeek, Groq, Gemini, Mistral, Claude, and OpenRouter in `backend/config/models.js`
- Live provider catalogs for `openrouter`, `together`, and `anyapi`
- Authenticated and anonymous chat flows
- **Real provider token streaming** — all 10 providers stream native tokens via SSE. No artificial `setTimeout` delays. Tool-call rounds are handled transparently: tool status events are sent during processing, then the final answer streams in naturally.
- Shared pipeline (`chatPipeline.service.js`) keeps legacy JSON and streaming chat behavior aligned
- OrchestratorBrain is wired into `/api/chat/stream` as a real pre-stream runtime layer using the custom graph, agent, callback, tracing, parser, retriever, vector-store, and flow-visibility services.
- Human approval checkpoints are persisted in Supabase (`human_approvals`) and controlled through `/api/approvals`, so Vercel/serverless invocations do not wait in memory for a human response.
- RAG, semantic cache, token accounting, context summarization, and cross-chat memory
- File upload, search, and abort cleanup
- AI file generation: Image (Recraft/FLUX via OpenRouter), PPT (pptxgenjs), PDF (pdfkit), Excel (exceljs), Word (docx), CSV, Chart (SVG), HTML, JSON, Markdown — all triggered via `[GENERATE_XXX]` tags in chat
- Admin dashboard and analytics
- Theme toggle with persistent preferences
- Sentry integration on frontend and backend

## AI Framework Features (LangChain/LangGraph/LangSmith Equivalent)

**Complete AI Orchestration System:** 16+ microservices providing production-ready workflows

### Document Processing & Retrieval
- Load documents in 40+ file formats (PDF, Word, Excel, Code, Images, Archives)
- 4 intelligent text chunking strategies with automatic selection
- Vector stores with multiple backends (PgVector, In-Memory, Hybrid)
- 6 retrieval strategies (Vector, BM25, Hybrid, Metadata, Reranker, Chained)
- Full-text and semantic search integration

### Language Model Operations
- 5 output parser types for structured data extraction
- 8 prompt template types (basic, few-shot, chat, conditional, formatted, role-based, loop, composer)
- 6 in-process memory strategies (buffer, summary, entity tracking, token-aware, window, combined)
- Cross-chat RAG memory via `embedAndStoreMessage` and `searchMemory` (accurate mode only)

### Workflow Orchestration
- 6 chain types for sequential operations
- Conditional branching (if/else) and parallel execution
- ReAct agents with dynamic tool selection and multi-turn reasoning
- Graph-based workflows (DAG) with conditional routing
- SmartAgent for intelligent orchestration combining all features

### Loop & Refinement
- Cycle management with counters and exit conditions
- Agent refinement loops for iterative answer improvement
- Query loops with retry and refinement
- Validation loops for checking and fixing output
- Pipeline loops for multi-step processing

### Human-in-the-Loop & Control
- Approval checkpoints with state snapshots
- Interrupt points before/after specific operations
- Audit trails for compliance
- Cost and token tracking per operation

### Observability & Debugging
- Complete execution tracing with step hierarchies
- Variable and state tracking across operations
- Flow visualization (Mermaid diagrams, dependency graphs, heat maps)
- Critical path analysis and bottleneck detection
- Step-through debugging with breakpoints and watches
- Real-time dashboard metrics
- Automatic optimization suggestions

## Project Layout

- `backend/server.js` wires middleware, CORS, CSRF, Sentry, routes, and cleanup jobs.
- `backend/routes/chat.routes.js` handles canonical `/stream`, legacy `/message` compatibility, model listing, and provider model lookup.
- `backend/controllers/chat.controller.js` owns the main chat pipeline.
- `backend/services/` contains cache, RAG, token budget, file upload, context, summary, analytics, and provider services.
- `frontend/src/App.jsx` defines `/login`, `/anonymous`, `/chat`, and `/admin`.
- `frontend/src/components/` contains the chat UI, theme toggle, token bar, unified model modal, and admin UI.

## Environment Variables

### Backend

Required:

- `PORT`
- `FRONTEND_URL`
- `NODE_ENV`
- `JWT_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

Common optional values:

- `SENTRY_DSN`
- `BIZ_SUPABASE_URL`
- `BIZ_SUPABASE_SERVICE_KEY`
- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `MISTRAL_API_KEY`
- `COHERE_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `DEEPSEEK_API_KEY`
- `OPENROUTER_API_KEY`
- `TOGETHER_API_KEY`
- `ANYAPI_API_KEY`
- `GEMINI_SUMMARY_API_KEY` — dedicated key for summarization (falls back to `GEMINI_API_KEY` if absent)
- `MISTRAL_SUMMARY_API_KEY` — dedicated key for summarization
- `CEREBRAS_SUMMARY_API_KEY` — dedicated key for summarization (Llama 3.1-8b fallback)

### Frontend

- `REACT_APP_API_URL`
- `REACT_APP_SENTRY_DSN`

## Local Setup

1. Install backend dependencies: `cd backend && npm install`
2. Install frontend dependencies: `cd ../frontend && npm install`
3. Copy `backend/.env.example` to `backend/.env`
4. Copy `frontend/.env.example` to `frontend/.env.local`
5. Start backend: `cd backend && npm run dev`
6. Start frontend: `cd frontend && npm start`

## Deployment

### Backend

1. Deploy `backend/` to Vercel.
2. Set backend env vars in Vercel.
3. Make sure `FRONTEND_URL` matches the frontend deployment exactly.
4. Redeploy after env changes.

### Frontend

1. Deploy `frontend/` to Vercel.
2. Set `REACT_APP_API_URL` to the backend API URL.
3. Set `REACT_APP_SENTRY_DSN` if Sentry is enabled.
4. Redeploy after env changes.

## Using the AI Framework Services

All AI framework services are exported through `backend/services/chat.service.js`:

```javascript
const {
  // Chains, agents, graphs
  createChain, SimpleChain, Agent, SmartAgent,
  Graph, GraphWorkflow,
  
  // Memory and state
  BufferMemory, SummaryMemory, MemoryManager,
  
  // Looping and refinement
  RefinementLoop, QueryLoop, LoopExecutor,
  
  // Approval and control
  HumanApprovalHandler, ApprovalRequest,
  
  // Tracing and visibility
  ExecutionTracer, TraceFormatter, TraceAnalyzer,
  FlowAnalyzer, FlowVisualizer, FlowDebugger
} = require('./chat.service');
```

### Example: Create a SmartAgent

```javascript
const { SmartAgent, GreedyToolSelection } = require('./chat.service');

const agent = new SmartAgent(modelDispatcher, toolRegistry, {
  modelId: 'claude-3-5-sonnet',
  maxIterations: 15,
  maxRefinements: 3,
  toolSelectionStrategy: new GreedyToolSelection(),
  approvalHandler,
  callbackManager,
  memory
});

const result = await agent.orchestrate('Analyze market trends', {
  requireApprovalFor: ['delete_data']
});
```

### Example: Create a Workflow Graph

```javascript
const { Graph, GraphBuilder } = require('./chat.service');

const graph = new Graph();
graph.addNode('fetch', fetchDataFn)
      .addNode('analyze', analyzeFn)
      .addNode('report', reportFn)
      .addEdge('fetch', 'analyze')
      .addEdge('analyze', 'report')
      .setStartNode('fetch');

const result = await graph.run(input);
```

### Example: Trace Execution

```javascript
const { ExecutionTracer, TraceFormatter } = require('./chat.service');

const tracer = new ExecutionTracer({ verbose: true });
tracer.startTrace('workflow');

const result = await tracer.traceAsync('expensive-operation', async () => {
  // operation code
});

const trace = tracer.completeTrace();
const mermaid = TraceFormatter.formatMermaidFlowchart(trace);
```

## Common Change Points

- Add or change models in `backend/config/models.js`.
- Add new provider catalogs in `backend/services/modelCatalog.service.js`.
- Adjust chat behavior in `backend/controllers/chat.controller.js` and `backend/routes/chat.routes.js`.
- Tune token budgeting in `backend/services/tokenBudget.service.js`.
- Tune history and summary behavior in `backend/services/context.service.js` and `backend/services/summary.service.js`.
- Cross-chat memory (accurate mode): `embedAndStoreMessage` and `searchMemory` in `backend/services/memory.service.js`. Requires `message_embeddings` table and `search_memory` RPC — run `database/migration_add_message_embeddings.sql` if not deployed.
- Cache: exact hash-based cache is disabled. Only semantic cache (`getSemanticCachedResponse`) is active. To re-enable exact cache, uncomment the `getCachedResponse` block in `chat.routes.js` and the `setCachedResponse` call in `chat.controller.js` — but note it will return stale answers for time-sensitive or DB-backed queries.
- Adjust RAG behavior in `backend/services/rag.service.js`.
- Change theme behavior in `frontend/src/context/ThemeContext.jsx` and `frontend/src/index.css`.
- Configure custom agents in controllers using `SmartAgent` or `ReActLoop`
- Add memory strategies via `MemoryManager` for conversation context
- Enable tracing and monitoring with `ExecutionTracer` and `FlowVisibility`

## Artifact Cleanup

AI-generated files are stored in `uploaded_files_rag` with the `topic_id` returned by the backend in the SSE `done` event. Deleting a chat triggers explicit cleanup in `backend/controllers/history.controller.js` (deletes from `uploaded_files_rag` and `uploaded_files` by `topic_id`) before calling the `delete_topic_cascade` RPC, so artifacts are removed even if the SQL function is not deployed. The sidebar re-fetches the artifact list after deletion to keep the UI in sync.

**One-time cleanup for pre-fix orphans** — run in Supabase SQL Editor if old generated files are still visible:
```sql
DELETE FROM uploaded_files_rag
WHERE topic_id IS NULL
  AND file_type IN ('generated','html','js','jsx','ts','tsx','css','json','xml','md','svg','py','sql','sh');
```

## Verification Checklist

- Backend boots without missing env errors.
- `/api/health` works.
- Login, chat, stream, admin, and anonymous routes all render.
- Model picker loads both static and live provider models.
- File upload, cache, RAG, and token accounting behave as expected.
- Theme toggle persists after refresh.
- AI generates a file in a chat → deleting that chat removes the file from the Artifacts sidebar immediately.

## Consolidation Note

The previous `DEPLOYMENT_GUIDE.md`, `SENTRY_SETUP.md`, and `THEME_IMPLEMENTATION.md` content has been merged into this file so the repo keeps one active implementation guide.
