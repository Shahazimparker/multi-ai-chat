# Multi-AI Chat Platform Management Summary

> Brand: Azim's AI Chatbot

## Executive Summary

Multi-AI Chat is a full-stack chat platform that unifies 15 configured AI models and 3 live provider catalogs behind one interface. The current implementation supports authenticated users, anonymous chat, file upload, retrieval-augmented responses, caching, token quotas, admin management, theme persistence, and live model discovery.

## Business Value

- One UI for multiple providers reduces vendor lock-in.
- Free and paid model options help control operating cost.
- RAG lets the system answer from uploaded documents and business data.
- Exact and semantic caching reduce repeated API spend.
- Token quotas prevent runaway usage.
- Anonymous mode lowers onboarding friction.

## Current Architecture

- Frontend: React app deployed on Vercel.
- Backend: Express API deployed on Vercel.
- Database: Supabase/PostgreSQL with `pgvector`.
- Integrations: Sentry, AI provider SDKs, file processing, and business DB tooling.

## Current Product Surface

| Area | Current State |
|---|---|
| Auth | Login, JWT sessions, admin checks, anonymous access |
| Chat | Streaming and non-streaming responses |
| Models | 15 configured models plus live catalogs for `openrouter`, `together`, and `anyapi` |
| Memory | History context and summarization |
| RAG | File and document retrieval support |
| Cache | Exact and semantic query caching |
| Admin | User management, quota controls, analytics |
| UX | Theme toggle, mobile navigation, token bar, unified model modal |
| Observability | Backend and frontend Sentry integration |
| Finance | Separate finance route in the frontend app |

## Key Risks

- Token accounting and stream persistence need regression coverage.
- Provider API changes can affect live model catalogs.
- Business DB tool flows need careful prompt and schema validation.
- Sentry and CSRF behavior should be verified after environment changes.

## What To Monitor

- Login and chat success rate.
- Cache hit rate.
- Token consumption by user and model.
- Upload and RAG success rate.
- Admin operations and quota enforcement.
- Frontend and backend error volume in Sentry.

## Recommendation

Use `GUIDE.md` as the implementation/deployment reference and `TESTING.md` as the verification reference. The smaller topic docs have been merged into those files so this document stays focused on product and management context.
