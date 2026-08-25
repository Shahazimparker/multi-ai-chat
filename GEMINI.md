# Multi-AI Chat — AI Agent Guidelines & Context

Please see [AGENTS.md](./AGENTS.md) for full project architecture, deployment environment, cloud infrastructure, free-tier quotas, and operational rules.

### Quick Deployment & Infra Summary
- **Vercel (Frontend & Backend)**: Free (Hobby) Tier | Region: **Mumbai (`bom1`)** | `maxDuration: 300s`
- **Supabase (PostgreSQL + pgvector)**: Free Tier | Region: **Singapore (`ap-southeast-1`)** | 500MB DB Limit
- **Vercel Blob Storage**: Private store `multi-chat-upload-storage` in **Mumbai (`bom1`)**
- **Upload Strategy**: Direct browser-to-blob upload (up to 50MB) bypassing 4.5MB serverless edge body limits; `blob_url` pointer saved in DB instead of Base64 strings.
- **Prompt Context & Token Rules**: Query compression is disabled for all models to preserve raw prompt text; model context windows (DeepSeek 128k, Mistral 32k, Claude 200k, Groq/Gemini 5,999) are strictly enforced with error feedback on overflow; embeddings are safely bounded to prevent database bloat under Supabase 500MB free tier.
