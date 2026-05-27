# Multi-AI Chat

Unified AI chat platform with authentication, anonymous mode, file-aware chat (RAG), streaming responses, token controls, and admin analytics.

## Current Scope

- Frontend: React (`frontend/`)
- Backend: Express API (`backend/`)
- Database: Supabase PostgreSQL + `pgvector` (`database/`)
- Deployment target: Vercel (frontend + backend)

## Core Capabilities

- Model routing via `backend/config/models.js` (current configured registry)
- Live provider model discovery for `openrouter`, `together`, `anyapi`
- Chat endpoints: `/api/chat/message` and `/api/chat/stream` (SSE)
- Authenticated and anonymous chat flows
- Query cache (exact + semantic), RAG context, history summarization
- File upload/search integration
- Admin panel (users, quotas, analytics)
- Theme toggle and finance route in frontend
- Sentry integration (frontend + backend)

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

## License

MIT
