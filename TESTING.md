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
- AI-generated file `topic_id` association — files must be saved after the stream `done` event so the backend-assigned `topic_id` is available (`frontend/src/pages/ChatPage.jsx`)

## Test Status

There is no dedicated backend test runner configured in `backend/package.json`. The practical coverage today is:

- Frontend: `npm run test` from `frontend`
- Backend: manual regression checks plus `eslint`

## Merged Checklists

The detailed checklists previously split across `TESTING_CHECKLIST.md` and `TESTING_DETAILED.md` have been consolidated here. Use this file as the single testing reference.
