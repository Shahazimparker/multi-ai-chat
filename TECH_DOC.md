# Multi-AI Chat Technical Documentation

This document is the technical reference for the current codebase state.

## Architecture

- Frontend: React app in `frontend/`
- Backend: Node.js/Express API in `backend/`
- Database: Supabase/PostgreSQL with `pgvector`
- Deployment: Vercel (`frontend/vercel.json`, `backend/vercel.json`)

## Backend Overview

### Entry and middleware

- Entry point: `backend/server.js`
- Security/logging: `helmet`, `cors`, `morgan`
- Request parsing: JSON body (`10mb`)
- Global middleware: CSRF protection, Sentry handlers, token cleanup jobs
- Main routes:
  - `/api/auth`
  - `/api/chat`
  - `/api/admin`
  - `/api/history`
  - `/api/upload`
  - `/api/health`

### Core route modules

- `backend/routes/auth.routes.js`
- `backend/routes/chat.routes.js`
- `backend/routes/admin.routes.js`
- `backend/routes/history.routes.js`
- `backend/routes/upload.routes.js`

### Controllers

- `backend/controllers/auth.controller.js`
- `backend/controllers/chat.controller.js`
- `backend/controllers/admin.controller.js`
- `backend/controllers/history.controller.js`

### Core services

- Chat orchestration: `backend/services/chat.service.js`
- Context and memory: `backend/services/context.service.js`, `backend/services/memory.service.js`, `backend/services/summary.service.js`
- RAG and embeddings: `backend/services/rag.service.js`
- File pipeline: `backend/services/fileUpload.service.js`
- Cache: `backend/services/cache.service.js`
- Token budgeting: `backend/services/tokenBudget.service.js`
- Analytics: `backend/services/analytics.service.js`
- Similarity and compression: `backend/services/similarity.service.js`, `backend/services/compress.service.js`
- Business DB support: `backend/services/businessDb.service.js`, `backend/services/businessRagSync.service.js`
- Tool execution helpers: `backend/services/tools/webSearch.service.js`, `backend/services/tools/codeExecute.service.js`

### AI provider layer

- Dispatcher: `backend/services/ai/dispatcher.service.js`
- Provider modules:
  - `gemini.service.js`
  - `groq.service.js`
  - `mistral.service.js`
  - `deepseek.service.js`
  - `claude.service.js`
  - `openrouter.service.js`
  - `openai.service.js`
  - `cohere.service.js`
  - `together.service.js`
  - `anyapi.service.js`
  - `unified.service.js` (shared OpenAI-compatible caller)

### Model configuration

- Source of truth: `backend/config/models.js`
- Current configured registry: 15 model entries
- Configured provider families in the registry: DeepSeek, Groq, Gemini, Mistral, Claude, OpenRouter
- Live model catalog endpoint support (not static model registry entries): `openrouter`, `together`, `anyapi` via `backend/services/modelCatalog.service.js`

### Middleware modules

- Auth: `backend/middleware/auth.js`
- Token quota: `backend/middleware/tokenCheck.js`
- Input sanitization: `backend/middleware/sanitize.js`
- CSRF: `backend/middleware/csrf.js`
- Sentry context: `backend/middleware/sentryContext.js`

## Frontend Overview

### Entry and routing

- App root: `frontend/src/App.jsx`
- Route map:
  - `/login`
  - `/anonymous`
  - `/chat`
  - `/finance`
  - `/admin`

### State/config

- Auth context: `frontend/src/context/AuthContext.jsx`
- Theme context: `frontend/src/context/ThemeContext.jsx`
- API client: `frontend/src/config/api.js`

### Key pages

- `frontend/src/pages/LoginPage.jsx`
- `frontend/src/pages/ChatPage.jsx`
- `frontend/src/pages/AnonymousPage.jsx`
- `frontend/src/pages/AdminPage.jsx`
- `frontend/src/pages/Finance/FinancePage.jsx`

### Key UI components

- Chat UI: `frontend/src/components/chat/*`
- Layout/theme/token bar: `frontend/src/components/layout/*`
- Admin modal: `frontend/src/components/admin/UserModal.jsx`

## Database and SQL Assets

- Primary schema: `database/schema.sql`
- Additional migrations and utility scripts:
  - `database/token_optimization.sql`
  - `database/migration_add_message_embeddings.sql`
  - `database/migration_add_locked_until.sql`
  - `database/migration_delete_topic_cascade.sql`
  - `database/business_supabase_functions.sql`
  - ERP sample/schema assets under `database/`

## Environment Variables

### Backend minimum

- `JWT_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `FRONTEND_URL`

### Backend optional/common

- `SENTRY_DSN`
- `BIZ_SUPABASE_URL`
- `BIZ_SUPABASE_SERVICE_KEY`
- Provider API keys used by configured or optional provider modules

### Frontend

- `REACT_APP_API_URL`
- `REACT_APP_SENTRY_DSN` (optional)

## Testing Reality

- Backend has no dedicated unit/integration test script in `backend/package.json`
- Frontend test command exists (`react-scripts test`)
- Current backend validation pattern is lint + manual regression (`TESTING.md`)

## Related Docs

- Implementation guide: `GUIDE.md`
- Testing guide: `TESTING.md`
- Management summary: `MANAGEMENT_PRESENTATION.md`
