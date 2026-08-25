# Multi-AI Chat — AI Agent Guidelines & Context

Please see [AGENTS.md](./AGENTS.md) for full project architecture, deployment environment, cloud infrastructure, free-tier quotas, and operational rules.

### Quick Deployment & Infra Summary
- **Vercel (Frontend & Backend)**: Free (Hobby) Tier | Region: **Mumbai (`bom1`)** | `maxDuration: 300s`
- **Supabase (PostgreSQL + pgvector)**: Free Tier | Region: **Singapore (`ap-southeast-1`)** | 500MB DB Limit
- **Vercel Blob Storage**: Private store `multi-chat-upload-storage` in **Mumbai (`bom1`)**
- **Upload Strategy**: Direct browser-to-blob upload (up to 50MB) bypassing 4.5MB serverless edge body limits; `blob_url` pointer saved in DB instead of Base64 strings.
- **Prompt Context & Token Rules**: Query compression is disabled for all models to preserve raw prompt text; model context windows (DeepSeek 128k, Mistral 32k, Claude 200k, Groq/Gemini 5,999) are strictly enforced with error feedback on overflow; embeddings are safely bounded to prevent database bloat under Supabase 500MB free tier; reserved output tokens increased to 4,000 for $\ge 32\text{k}$ models.
- **Log & SAP Diagnostics**: Automatic SAP ST22 short dump sectional parser + multi-technology incident classifier (Linux, databases, cloud, app runtimes) inspired by Logdy, OpenObserve, and Hanadumpviewer, with dynamic live Web Search cross-referencing loop (`[WEB_SEARCH]` ➔ `[SEARCH_FILES]`).
- **Storage & Zero-Orphan Cascades**: Hierarchical collision-proof Vercel Blob namespacing; on-demand Blob fallback; 100% atomic cascade deletion across all 18 PostgreSQL tables and Vercel Blob storage.
- **Embedding & OCR Config**: `DEFAULT_EMBEDDING_PROVIDER` (defaults to `openrouter`, supports `mistral`), with configurable PDF OCR (`mistral-ocr-latest`) and Vision fallback.
