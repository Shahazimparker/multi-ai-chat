# Multi-AI Chat — AI Agent Guidelines & Context

Please see [AGENTS.md](./AGENTS.md) for full project architecture, deployment environment, cloud infrastructure, free-tier quotas, and operational rules.

### Quick Deployment & Infra Summary
- **Vercel (Frontend & Backend)**: Free (Hobby) Tier | Region: **Mumbai (`bom1`)** | `maxDuration: 300s`
- **Supabase (PostgreSQL + pgvector)**: Free Tier | Region: **Singapore (`ap-southeast-1`)** | 500MB DB Limit
- **Vercel Blob Storage**: Private store `multi-chat-upload-storage` in **Mumbai (`bom1`)**
- **Upload Strategy**: Direct browser-to-blob upload (up to 50MB) bypassing 4.5MB serverless edge body limits; `blob_url` pointer saved in DB instead of Base64 strings.
- **Prompt Context & Token Rules**: Query compression via secondary LLMs is disabled for all models to preserve raw prompt text; model context windows (DeepSeek 128k, Mistral 128k / Codestral 256k, Claude 200k, Groq/Gemini 5,999) are strictly enforced with error feedback on overflow; embeddings are safely bounded to prevent database bloat under Supabase 500MB free tier; reserved output tokens increased to 4,000 for $\ge 32\text{k}$ models.
- **Log & SAP Diagnostics**: Automatic SAP ST22 short dump sectional parser + multi-technology incident classifier (Linux, databases, cloud, app runtimes) inspired by Logdy, OpenObserve, and Hanadumpviewer, with dynamic live Web Search cross-referencing loop (`[WEB_SEARCH]` ➔ `[SEARCH_FILES]`).
- **Cohere Cross-Encoder Reranking & 429 Resilience**: Active across Knowledge Collections (RAG 2.0) and per-chat uploaded files and logs (`searchUserFilesRAG`, `buildRAGContext`). When Free-Tier 429 (10 RPM / 1000/mo cap) occurs, an in-memory circuit-breaker activates a 60s cooldown and searches smoothly proceed with un-reranked keyword/vector results without failing the turn.
- **Storage & Zero-Orphan Cascades**: Hierarchical collision-proof Vercel Blob namespacing; on-demand Blob fallback; 100% atomic cascade deletion across all 18 PostgreSQL tables and Vercel Blob storage.
- **Embedding & OCR Config**: `DEFAULT_EMBEDDING_PROVIDER` (defaults to `openrouter`, supports `mistral`), with configurable PDF OCR (`mistral-ocr-latest`) and Vision fallback.
