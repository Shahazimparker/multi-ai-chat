# Multi-AI Chat Platform Management Summary

> Brand: Azim's AI Chatbot

## Executive Summary

Multi-AI Chat is a full-stack chat platform that unifies 15 configured AI models and 3 live provider catalogs behind one interface. The current implementation supports authenticated users, file upload, retrieval-augmented responses, caching, token quotas, admin management, theme persistence, and live model discovery.

**New since last review:** Complete Knowledge Base (RAG 2.0) system with collection management, web crawling, vision extraction, PDF OCR, RAPTOR hierarchical summarization, GraphRAG entity/relation retrieval, and Cohere cross-encoder reranking. Plus reasoning model support (chain-of-thought), temporal grounding, serverless-safe rate limiting and brute-force lockout, embedding space correctness guarantees, and idle session logout.

---

## Business Value

- One UI for multiple providers reduces vendor lock-in.
- Free and paid model options help control operating cost.
- **Knowledge Base (RAG 2.0)**: upload documents, crawl websites, or add notes into named collections; the AI answers from them with cited passages and relevance scores.
- URL intelligence reads and summarizes user-provided links in chat, with dedicated handling for code repos and major knowledge/content sites.
- Semantic caching reduces repeated API spend.
- Token quotas prevent runaway usage.
- **Reasoning models**: chain-of-thought visible to users in a collapsible panel, stored in DB for history reloads.
- **Temporal grounding**: the model always knows today's date/time in the user's timezone.
- Human-in-the-loop approval gates provide control and compliance for file generation.
- Enterprise-grade AI orchestration enables complex, multi-step workflows when needed.

---

## Current Architecture

- Frontend: React app deployed on Vercel (with lazy-loaded admin and knowledge pages)
- Backend: Express API deployed on Vercel (serverless, trust-proxy aware)
- Database: Supabase/PostgreSQL with `pgvector`
- Integrations: Sentry, AI provider SDKs, Cohere reranking, Mistral OCR, Tesseract.js, pptxgenjs, pdfkit

---

## Current Product Surface

| Area | Current State |
|---|---|
| Auth | Login, JWT cookie sessions, admin checks, brute-force lockout, idle logout |
| Chat | Streaming + non-streaming; reasoning/thinking mode per model |
| Models | 15 configured models (DeepSeek, Groq, Gemini, Mistral, Claude, OpenRouter) + live catalogs for `openrouter`, `together`, `anyapi` |
| Reasoning | Per-model effort levels (low/medium/high/max/xhigh); chain-of-thought panel; stored in DB |
| Memory | Per-topic history with dynamic summarization + cross-chat semantic memory (accurate mode) |
| RAG (chat uploads) | File and document retrieval, hybrid cosine+BM25+Jaccard+RRF reranking |
| **Knowledge Base (New)** | Named collections; file/web/text ingest; RAPTOR tree; GraphRAG; dense+sparse+graph retrieval; Cohere cross-encoder reranking |
| URL Intelligence | Deep-read for GitHub/GitLab/Bitbucket/StackOverflow + major content/doc domains; generic fallback extraction |
| Web Search | `Exa → Firecrawl → Tavily → SerpAPI` + LangSearch; per-chat toggle (not global) |
| Cache | Semantic query caching (vector similarity ≥ 0.92); exact cache disabled to prevent stale answers |
| Temporal Context | Date/time/week injected into every system prompt; per-user IANA timezone preference |
| File Generation | 10 types (Image, PPT, PDF, Excel, DOCX, CSV, Chart, HTML, JSON, Markdown) with inline approval |
| Admin | User management, quota controls, analytics (SQL-aggregated, not capped at 1000 rows) |
| Rate Limiting | Serverless-safe via Supabase `rate_limit_counters`; login lockout via `login_attempt_counters` |
| UX | Theme toggle, mobile navigation, Knowledge Bases link in mobile nav, token bar, idle logout |
| Observability | Backend and frontend Sentry; structured logging |

---

## Enterprise AI Orchestration

| Capability | Details |
|---|---|
| **Knowledge Base** | Named collections, multi-source ingest, inspect chunks, cite passages |
| **RAPTOR** | Hierarchical summary trees; broad questions match summaries, specific ones match passages |
| **GraphRAG** | Entity/relation graph; retrieval can assemble answers from two separate passages |
| **Reranking** | Cohere cross-encoder reranking; calibrated 0-1 relevance score; passages below threshold dropped |
| **Query Expansion** | Multi-query + HyDE for better recall |
| **Approval Gates** | Inline Yes/Other/No for all file generation; persisted in Supabase; IDOR-safe |
| **Workflows** | Chains, graphs, agents with conditional routing (OrchestratorBrain, off by default) |
| **Tracing** | Complete step-by-step execution tracing; TTL+LRU eviction |
| **Memory** | 6 in-process strategies + cross-chat RAG memory |

---

## Key Risks

- Provider API changes can affect live model catalogs; `RETIRED_MODELS` map prevents silent re-routing to wrong models.
- RAPTOR and GraphRAG builds are expensive (LLM calls per chunk); CLI scripts have dry-run flags and time budgets.
- Serverless platform kills invocations at 300s; `CHAT_TIME_BUDGET_MS` (240s) provides headroom for persistence and analytics.
- Cross-space embedding failover is deliberately blocked — mixing vector spaces would return garbage silently.
- `message_embeddings` table and `search_memory` RPC must be deployed for cross-chat memory to work.
- Cohere reranking requires `COHERE_API_KEY`; without it the system falls back to RRF ordering.
- `get_admin_analytics()` SQL function must be deployed for admin analytics to return correct totals.
- Sentry and CSRF behavior should be verified after environment changes.

---

## What To Monitor

- Login and chat success rate; brute-force lockout hits
- Cache hit rate; token consumption by user and model
- Knowledge Base ingest success/failure rate; OCR and vision extraction fallback rates
- Approval gate response time and rejection/timeout rate
- RAPTOR and GraphRAG build job completion and error rates
- URL-read success/fallback ratios by domain
- Frontend and backend error volume in Sentry
- Admin analytics: total queries, tokens, daily usage, model distribution

---

## Recommendation

Use [`docs/GUIDE.md`](./GUIDE.md) as the implementation/deployment reference and [`docs/testing/TESTING.md`](./testing/TESTING.md) as the verification reference.
