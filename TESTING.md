# Multi-AI Chat Testing Guide

This is the current test reference for the repo. It reflects the live backend/frontend configuration in this workspace.

## Current Scope

- Backend: Express API with auth, chat, upload, history, admin, token checks, CSRF, Sentry, business DB helpers, caching, RAG, and provider routing.
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
- Cache hit responses return quickly and report `cacheHit: true`.
- RAG-enabled queries inject document context only when topic/file context exists.
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

## Current High-Risk Areas

- SSE stream handling in `backend/routes/chat.routes.js`
- Token accounting in `backend/controllers/chat.controller.js`
- RAG and semantic cache integration in `backend/services/rag.service.js` and `backend/services/cache.service.js`
- Business DB tool loop in `backend/services/chat.service.js`
- Provider catalog loading in `backend/services/modelCatalog.service.js`

## Test Status

There is no dedicated backend test runner configured in `backend/package.json`. The practical coverage today is:

- Frontend: `npm run test` from `frontend`
- Backend: manual regression checks plus `eslint`

## Merged Checklists

The detailed checklists previously split across `TESTING_CHECKLIST.md` and `TESTING_DETAILED.md` have been consolidated here. Use this file as the single testing reference.
