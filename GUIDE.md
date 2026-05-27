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
- Streaming and non-streaming chat endpoints
- RAG, query cache, token accounting, and context summarization
- File upload, search, and abort cleanup
- Admin dashboard and analytics
- Theme toggle with persistent preferences
- Sentry integration on frontend and backend
- Finance route in the frontend app
- Business DB support for tool-driven chat flows

## Project Layout

- `backend/server.js` wires middleware, CORS, CSRF, Sentry, routes, and cleanup jobs.
- `backend/routes/chat.routes.js` handles `/message`, `/stream`, model listing, and provider model lookup.
- `backend/controllers/chat.controller.js` owns the main chat pipeline.
- `backend/services/` contains cache, RAG, token budget, file upload, context, summary, analytics, and provider services.
- `frontend/src/App.jsx` defines `/login`, `/anonymous`, `/chat`, `/finance`, and `/admin`.
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

## Common Change Points

- Add or change models in `backend/config/models.js`.
- Add new provider catalogs in `backend/services/modelCatalog.service.js`.
- Adjust chat behavior in `backend/controllers/chat.controller.js` and `backend/routes/chat.routes.js`.
- Tune token budgeting in `backend/services/tokenBudget.service.js`.
- Tune history and summary behavior in `backend/services/context.service.js` and `backend/services/summary.service.js`.
- Adjust cache logic in `backend/services/cache.service.js`.
- Adjust RAG behavior in `backend/services/rag.service.js`.
- Change theme behavior in `frontend/src/context/ThemeContext.jsx` and `frontend/src/index.css`.

## Verification Checklist

- Backend boots without missing env errors.
- `/api/health` works.
- Login, chat, stream, admin, anonymous, and finance routes all render.
- Model picker loads both static and live provider models.
- File upload, cache, RAG, and token accounting behave as expected.
- Theme toggle persists after refresh.

## Consolidation Note

The previous `DEPLOYMENT_GUIDE.md`, `SENTRY_SETUP.md`, and `THEME_IMPLEMENTATION.md` content has been merged into this file so the repo keeps one active implementation guide.
