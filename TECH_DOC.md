# MultiAI Chat Platform — Technical Documentation

> **Brand**: Azim's AI Chatbot  
> **Type**: Full-stack web application — unified chat interface connecting 10+ AI providers  
> **Architecture**: Monorepo (backend/Node.js/Express + frontend/React + database/PostgreSQL)  
> **Deployment**: Backend & Frontend on Vercel, Database on Supabase

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Backend](#2-backend)
   - 2.1 [Entry Point & Server Configuration](#21-entry-point--server-configuration)
   - 2.2 [Configuration](#22-configuration)
   - 2.3 [Middleware](#23-middleware)
   - 2.4 [Routes](#24-routes)
   - 2.5 [Controllers](#25-controllers)
   - 2.6 [AI Services](#26-ai-services)
   - 2.7 [Core Services](#27-core-services)
3. [Frontend](#3-frontend)
   - 3.1 [Entry Point & Routing](#31-entry-point--routing)
   - 3.2 [Configuration & Auth Context](#32-configuration--auth-context)
   - 3.3 [Pages](#33-pages)
   - 3.4 [Components](#34-components)
4. [Database Schema](#4-database-schema)
   - 4.1 [Tables](#41-tables)
   - 4.2 [Functions & Indexes](#42-functions--indexes)
5. [AI Models Supported](#5-ai-models-supported)
6. [Key Features](#6-key-features)
7. [Tech Stack](#7-tech-stack)
8. [File-to-Feature Mapping](#8-file-to-feature-mapping)
   - 8.1 [Authentication & Authorization](#81-authentication--authorization)
   - 8.2 [Chat Pipeline (Core)](#82-chat-pipeline-core)
   - 8.3 [AI Provider Integrations](#83-ai-provider-integrations)
   - 8.4 [RAG (Retrieval-Augmented Generation)](#84-rag-retrieval-augmented-generation)
   - 8.5 [File Processing](#85-file-processing)
   - 8.6 [Memory & Context Management](#86-memory--context-management)
   - 8.7 [History & Topics](#87-history--topics)
   - 8.8 [Admin & Analytics](#88-admin--analytics)
   - 8.9 [Token Management](#89-token-management)
   - 8.10 [Anonymous Mode](#810-anonymous-mode)
   - 8.11 [Model Selection](#811-model-selection)
   - 8.12 [Database & Schema](#812-database--schema)
   - 8.13 [Frontend Routing & Layout](#813-frontend-routing--layout)
   - 8.14 [Server & Deployment](#814-server--deployment)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React 18)                       │
│  Vercel Deployment                                           │
│  Pages: Login | Chat | Anonymous | Admin                     │
│  State: AuthContext (JWT) + sessionStorage                   │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP / SSE
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend (Node.js/Express)                  │
│  Vercel Deployment                                           │
│  Middleware: Helmet, Morgan, CORS, Auth, TokenCheck          │
│  Routes: /api/auth, /api/chat, /api/admin, /api/history,    │
│          /api/upload                                         │
│  Controllers → Services → AI Providers                       │
└──────────────────────┬──────────────────────────────────────┘
                       │ Supabase JS SDK (service_role)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              Database (PostgreSQL + pgvector)                │
│  Supabase Hosted                                             │
│  Tables: users, sessions, topics, messages, query_cache,     │
│          query_analytics, rag_documents, uploaded_files,     │
│          rag_chunks                                          │
│  Extensions: pgvector (1536-dim embeddings)                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Backend

### 2.1 Entry Point & Server Configuration

**File**: [`backend/server.js`](backend/server.js)

Express application configured with:
- **helmet** — Security headers
- **morgan** — HTTP request logging
- **cors** — Cross-origin resource sharing
- **JSON body parser** — 10MB limit (accommodates RAG payloads)
- **Static file serving** — Uploaded files directory

**Route Mounting**:

| Prefix | Router File |
|--------|-------------|
| `/api/auth` | [`backend/routes/auth.routes.js`](backend/routes/auth.routes.js) |
| `/api/chat` | [`backend/routes/chat.routes.js`](backend/routes/chat.routes.js) |
| `/api/admin` | [`backend/routes/admin.routes.js`](backend/routes/admin.routes.js) |
| `/api/history` | [`backend/routes/history.routes.js`](backend/routes/history.routes.js) |
| `/api/upload` | [`backend/routes/upload.routes.js`](backend/routes/upload.routes.js) |
| `/api/health` | Health check endpoint |

### 2.2 Configuration

| File | Purpose |
|------|---------|
| [`backend/config/supabase.js`](backend/config/supabase.js) | Supabase client initialized with `service_role` key (bypasses Row Level Security for server-side operations) |
| [`backend/config/models.js`](backend/config/models.js) | Central registry of all 20+ supported AI models across 10 providers, including model IDs, display names, provider groupings, and free/paid classification |

### 2.3 Middleware

| Middleware | File | Function |
|------------|------|----------|
| **Auth** | [`backend/middleware/auth.js`](backend/middleware/auth.js) | JWT verification + session validation + account expiry check. Exports `requireAuth` and `requireAdmin` guards |
| **Token Check** | [`backend/middleware/tokenCheck.js`](backend/middleware/tokenCheck.js) | Blocks requests when user has exceeded their token quota |

### 2.4 Routes

#### Auth Routes [`backend/routes/auth.routes.js`](backend/routes/auth.routes.js)

| Method | Path | Handler | Auth |
|--------|------|---------|------|
| POST | `/login` | `authController.login` | No |
| GET | `/me` | `authController.getMe` | Yes |
| POST | `/logout` | `authController.logout` | Yes |

#### Chat Routes [`backend/routes/chat.routes.js`](backend/routes/chat.routes.js)

| Method | Path | Handler | Auth |
|--------|------|---------|------|
| GET | `/models` | List available models | Optional |
| GET | `/provider-models/:provider` | Live model catalog from provider | Optional |
| POST | `/message` | Send message (rate-limited) | Optional |
| POST | `/stream` | SSE streaming response | Optional |

#### Admin Routes [`backend/routes/admin.routes.js`](backend/routes/admin.routes.js)

Protected CRUD operations for user management, token resets, and analytics retrieval.

#### History Routes [`backend/routes/history.routes.js`](backend/routes/history.routes.js)

Topic listing, message retrieval, topic deletion, topic renaming.

#### Upload Routes [`backend/routes/upload.routes.js`](backend/routes/upload.routes.js)

File upload (multer, 50MB limit), file search, file deletion.

### 2.5 Controllers

#### Auth Controller [`backend/controllers/auth.controller.js`](backend/controllers/auth.controller.js)

- **`login`** — Validates credentials with bcrypt, issues JWT, creates session record
- **`getMe`** — Returns current user with refreshed token stats
- **`logout`** — Invalidates session

#### Chat Controller [`backend/controllers/chat.controller.js`](backend/controllers/chat.controller.js)

Core chat pipeline (executed in order):

1. **Prompt Compression** — Strips filler words via `compress.service.js`
2. **Cache Check** — Two-tier lookup (exact SHA-256 hash → semantic pgvector match)
3. **RAG Context** — Retrieves relevant documents via `rag.service.js`
4. **History Context** — Builds conversation context via `context.service.js`
5. **AI Dispatch** — Routes to correct provider via `dispatcher.service.js`
6. **Token Tracking** — Deducts from user's token budget
7. **Save to DB** — Persists message and topic
8. **Analytics Logging** — Records query to `query_analytics`
9. **Abort Support** — Client can cancel mid-generation

#### Admin Controller [`backend/controllers/admin.controller.js`](backend/controllers/admin.controller.js)

- CRUD operations on users
- Token reset functionality
- Analytics: model usage distribution, top queries, daily usage trends, cache hit rate

#### History Controller [`backend/controllers/history.controller.js`](backend/controllers/history.controller.js)

- List topics (paginated)
- Get messages for a topic
- Delete topic (cascade deletes messages)
- Rename topic

### 2.6 AI Services

#### Dispatcher [`backend/services/ai/dispatcher.service.js`](backend/services/ai/dispatcher.service.js)

Router that maps a provider string to the correct AI service module. Central dispatch point for all model requests.

#### Provider Implementations

| Service | File | Models | Key Details |
|---------|------|--------|-------------|
| **Gemini** | [`backend/services/ai/gemini.service.js`](backend/services/ai/gemini.service.js) | Flash 2.5, Pro 2.5 | Google AI SDK, AbortSignal support |
| **Groq** | [`backend/services/ai/groq.service.js`](backend/services/ai/groq.service.js) | LLaMA 3.1 8B, LLaMA 3.3 70B | Ultra-fast inference via Groq LPU |
| **Mistral** | [`backend/services/ai/mistral.service.js`](backend/services/ai/mistral.service.js) | Small, Medium | Mistral AI SDK + embeddings (1024→1536 padded) |
| **Cohere** | [`backend/services/ai/cohere.service.js`](backend/services/ai/cohere.service.js) | Command R, Command R+ | Cohere SDK |
| **OpenAI** | [`backend/services/ai/openai.service.js`](backend/services/ai/openai.service.js) | GPT-4o Mini, GPT-4o | OpenAI SDK |
| **Claude** | [`backend/services/ai/claude.service.js`](backend/services/ai/claude.service.js) | Haiku, Sonnet, Opus | Anthropic SDK with prompt caching |
| **DeepSeek** | [`backend/services/ai/deepseek.service.js`](backend/services/ai/deepseek.service.js) | v4 Flash, v4 Pro | DeepSeek API |
| **OpenRouter** | [`backend/services/ai/openrouter.service.js`](backend/services/ai/openrouter.service.js) | Llama, Gemini Flash, Mistral, Claude, GPT | Aggregator — multiple models via single API |
| **Together AI** | [`backend/services/ai/together.service.js`](backend/services/ai/together.service.js) | Llama 3.1 8B/70B Turbo | Together AI API |
| **AnyAPI** | [`backend/services/ai/anyapi.service.js`](backend/services/ai/anyapi.service.js) | GPT-4o Mini, GPT-4o, Claude 3.5 Sonnet | Alternative API gateway |

#### Unified Service [`backend/services/ai/unified.service.js`](backend/services/ai/unified.service.js)

Shared OpenAI-compatible HTTP caller used by OpenRouter, Together AI, and AnyAPI providers. Standardizes request/response handling across unified providers.

### 2.7 Core Services

| Service | File | Purpose |
|---------|------|---------|
| **RAG** | [`backend/services/rag.service.js`](backend/services/rag.service.js) | Embedding generation (OpenAI/OpenRouter/Mistral/Gemini with caching), semantic document search via pgvector cosine similarity, RAG context builder |
| **Cache** | [`backend/services/cache.service.js`](backend/services/cache.service.js) | Two-tier caching: exact match (SHA-256 hash) + semantic match (pgvector, 0.92 threshold) |
| **Context** | [`backend/services/context.service.js`](backend/services/context.service.js) | Memory management: Summarized mode (auto-summarizes older messages via Gemini Flash) and Accurate mode (keeps raw history). Dynamic budget allocation based on complexity score and turn count |
| **Compress** | [`backend/services/compress.service.js`](backend/services/compress.service.js) | Strips filler words (please, kindly, can you, etc.) to reduce token consumption |
| **Token Budget** | [`backend/services/tokenBudget.service.js`](backend/services/tokenBudget.service.js) | Static and dynamic prompt budgeting. Allocates tokens across system/history/RAG/files/query. Complexity scoring for SAP/technical keywords |
| **Analytics** | [`backend/services/analytics.service.js`](backend/services/analytics.service.js) | Logs every query to `query_analytics` table for admin dashboard |
| **File Upload** | [`backend/services/fileUpload.service.js`](backend/services/fileUpload.service.js) | File processing pipeline: extracts text from PDF/DOCX/TXT/images/ZIP/code files. Stores in RAG with embeddings. Uses `/tmp` on Vercel |
| **Summary** | [`backend/services/summary.service.js`](backend/services/summary.service.js) | Multi-provider fallback summarization chain: OpenRouter → Gemini → Mistral → Cerebras → local truncation |
| **Similarity** | [`backend/services/similarity.service.js`](backend/services/similarity.service.js) | TF-IDF/Jaccard similarity computation for topic detection and deduplication |
| **Model Catalog** | [`backend/services/modelCatalog.service.js`](backend/services/modelCatalog.service.js) | Fetches live model lists from OpenRouter/Together/AnyAPI with 6-hour cache TTL |

---

## 3. Frontend

### 3.1 Entry Point & Routing

**File**: [`frontend/src/App.jsx`](frontend/src/App.jsx)

React Router v6 configuration:

| Path | Component | Access |
|------|-----------|--------|
| `/login` | `LoginPage` | Public |
| `/anonymous` | `AnonymousPage` | Public |
| `/chat` | `ChatPage` | Protected (requires auth) |
| `/admin` | `AdminPage` | Admin-only |

Entire app wrapped in `AuthProvider` context.

### 3.2 Configuration & Auth Context

| File | Purpose |
|------|---------|
| [`frontend/src/config/api.js`](frontend/src/config/api.js) | Axios instance with JWT interceptor. Auto-redirects to `/login` on 401 responses |
| [`frontend/src/context/AuthContext.jsx`](frontend/src/context/AuthContext.jsx) | Global auth state: login (with rememberMe), logout, refreshTokenStats. Restores session from localStorage/sessionStorage |

### 3.3 Pages

#### LoginPage [`frontend/src/pages/LoginPage.jsx`](frontend/src/pages/LoginPage.jsx)

- Username/password login form
- "Remember Me" toggle (localStorage vs sessionStorage)
- "Continue Anonymously" button for guest access
- Visual AI model pills showcasing supported providers (Gemini, Groq, Mistral, etc.)

#### ChatPage [`frontend/src/pages/ChatPage.jsx`](frontend/src/pages/ChatPage.jsx)

Main chat interface featuring:
- **Sidebar** — Topic list with rename/delete, new chat button, user info
- **Model Selector** — Dropdown grouped by provider with free/paid badges
- **Message List** — Markdown rendering with syntax highlighting
- **File Upload** — Paperclip button supporting PDF/TXT/DOCX/images/ZIP/code
- **Image Paste** — Paste images for vision-capable models
- **Memory Mode Controls** — Summarized+ / Accurate+ toggle
- **RAG Toggle** — Enable/disable document retrieval
- **Streaming Responses** — SSE-based real-time token streaming
- **Abort Support** — Stop AI generation mid-response

#### AnonymousPage [`frontend/src/pages/AnonymousPage.jsx`](frontend/src/pages/AnonymousPage.jsx)

No-login chat interface. Messages stored in `sessionStorage` only. All data cleared on tab close.

#### AdminPage [`frontend/src/pages/AdminPage.jsx`](frontend/src/pages/AdminPage.jsx)

Admin dashboard with:
- **User CRUD Table** — Create, edit, delete users
- **Token Management** — Reset and adjust token allocations
- **Analytics Dashboard**:
  - Daily usage bar chart (recharts)
  - Model usage pie chart
  - Top queries table
  - API status indicators

### 3.4 Components

| Component | File | Purpose |
|-----------|------|---------|
| **ModelSelector** | [`frontend/src/components/chat/ModelSelector.jsx`](frontend/src/components/chat/ModelSelector.jsx) | Provider-grouped dropdown with free/paid badges, unified provider modal trigger |
| **Sidebar** | [`frontend/src/components/chat/Sidebar.jsx`](frontend/src/components/chat/Sidebar.jsx) | Topic list with rename/delete, new chat, user info footer, admin panel link |
| **MessageBubble** | [`frontend/src/components/chat/MessageBubble.jsx`](frontend/src/components/chat/MessageBubble.jsx) | Markdown rendering (react-markdown), syntax highlighting (Prism), token usage display |
| **FileUpload** | [`frontend/src/components/chat/FileUpload.jsx`](frontend/src/components/chat/FileUpload.jsx) | Paperclip button, file input, upload progress |
| **UnifiedModelModal** | [`frontend/src/components/chat/UnifiedModelModal.jsx`](frontend/src/components/chat/UnifiedModelModal.jsx) | Modal for selecting sub-models from OpenRouter/Together/AnyAPI with search + refresh |
| **MobileNav** | [`frontend/src/components/chat/MobileNav.jsx`](frontend/src/components/chat/MobileNav.jsx) | Mobile sidebar drawer |
| **TokenBar** | [`frontend/src/components/layout/TokenBar.jsx`](frontend/src/components/layout/TokenBar.jsx) | Token usage progress bar (green < 60%, amber < 85%, red ≥ 85%) |
| **UserModal** | [`frontend/src/components/admin/UserModal.jsx`](frontend/src/components/admin/UserModal.jsx) | Create/edit user form |

---

## 4. Database Schema

**File**: [`database/schema.sql`](database/schema.sql)

### 4.1 Tables

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| **users** | `id`, `email`, `username`, `password_hash`, `role` (user/admin), `is_active`, `total_tokens`, `used_tokens`, `per_query_limit`, `session_minutes`, `expires_at` | User accounts and token quotas |
| **sessions** | `id`, `user_id`, `token_hash`, `expires_at` | JWT session tracking |
| **topics** | `id`, `user_id`, `title`, `model`, `created_at`, `updated_at` | Chat conversation threads |
| **messages** | `id`, `topic_id`, `role`, `content`, `model`, `tokens_used`, `is_summary` | Individual chat messages |
| **query_cache** | `id`, `query_hash` (SHA-256), `query_text`, `response`, `query_embedding` (vector(1536)) | Exact + semantic cache |
| **query_analytics** | `id`, `user_id`, `query`, `model`, `tokens_used`, `latency`, `created_at` | Analytics logging |
| **rag_documents** | `id`, `content`, `embedding` (vector(1536)), `metadata` | Knowledge base documents |
| **uploaded_files** | `id`, `user_id`, `filename`, `file_type`, `embedding` (vector(1536)) | User-uploaded file metadata |
| **rag_chunks** | `id`, `file_id`, `content`, `embedding` (vector(1536)), `chunk_index` | File fragments with embeddings |

### 4.2 Functions & Indexes

**PostgreSQL Functions**:
- `match_documents(query_embedding, match_threshold, match_count)` — Cosine similarity search for RAG
- `match_query_cache(query_embedding, match_threshold)` — Semantic cache lookup (0.92 threshold)
- `search_uploaded_files(query_embedding, match_threshold, user_id)` — Vector search across user's uploaded files
- `update_updated_at()` — Trigger function for auto-updating `updated_at` timestamps

**Indexes**:
- IVFFLAT index on `rag_documents.embedding`
- IVFFLAT index on `query_cache.query_embedding`

**RLS**: Row Level Security enabled on `users`, `topics`, `messages` tables (bypassed by `service_role` key used in backend config).

---

## 5. AI Models Supported

| Provider | Models | Pricing |
|----------|--------|---------|
| **Groq** | LLaMA 3.1 8B, LLaMA 3.3 70B | Free |
| **Google Gemini** | Flash 2.5, Pro 2.5 | Free |
| **Mistral** | Small, Medium | Free |
| **DeepSeek** | v4 Flash, v4 Pro | Paid |
| **Cohere** | Command R, Command R+ | Free |
| **OpenAI** | GPT-4o Mini, GPT-4o | Paid |
| **Anthropic Claude** | Haiku, Sonnet, Opus | Paid |
| **OpenRouter** | Llama 3.1 8B, Gemini Flash 1.5, Mistral 7B, Claude 3.5 Sonnet, GPT-4 Turbo, GPT-4o, Claude 3 Opus | Mixed |
| **Together AI** | Llama 3.1 8B Turbo, Llama 3.1 70B Turbo | Paid |
| **AnyAPI** | GPT-4o Mini, GPT-4o, Claude 3.5 Sonnet | Paid |

**Total: 10 providers, 20+ models**

---

## 6. Key Features

| Feature | Description |
|---------|-------------|
| **Multi-Provider AI** | 10 providers, 20+ models in a single unified interface |
| **RAG (Retrieval-Augmented Generation)** | pgvector-based semantic search across uploaded documents for context-aware responses |
| **Smart Caching** | Two-tier cache (exact SHA-256 hash + semantic pgvector match at 0.92 threshold) reduces API costs and latency |
| **Token Budgeting** | Dynamic allocation based on conversation complexity, with per-user quotas |
| **Memory Management** | Summarized mode (auto-compresses old messages via Gemini Flash) and Accurate mode (full raw history) |
| **Prompt Compression** | Strips filler words to save tokens and reduce costs |
| **File Upload** | PDF, DOCX, TXT, images, ZIP, code files — text extraction + RAG storage with embeddings |
| **Streaming Responses** | SSE-based real-time token streaming for responsive UX |
| **Anonymous Mode** | No login required; session-only storage, cleared on tab close |
| **Admin Dashboard** | User CRUD, token management, analytics with recharts visualizations |
| **Token Quota System** | Per-user token limits with visual progress bar (green/amber/red) |
| **Abort/Cancellation** | Users can stop AI generation mid-response |
| **Image Support** | Paste images for vision-capable models (GPT-4o, Gemini, Claude) |
| **Unified Providers** | OpenRouter, Together, AnyAPI — fetch live model lists with 6-hour cache |

---

## 7. Tech Stack

### Backend
- **Runtime**: Node.js
- **Framework**: Express
- **Authentication**: JWT + bcrypt
- **Database Client**: Supabase JS SDK (`service_role`)
- **AI SDKs**: `@anthropic-ai/sdk`, `@google/generative-ai`, `openai`, `groq-sdk`
- **File Processing**: `pdf-parse`, `mammoth` (DOCX), `jszip`
- **Middleware**: helmet, morgan, cors, multer

### Frontend
- **Framework**: React 18
- **Routing**: React Router v6
- **HTTP Client**: Axios (with JWT interceptor)
- **Markdown**: react-markdown
- **Syntax Highlighting**: react-syntax-highlighter (Prism)
- **Charts**: recharts
- **Icons**: lucide-react

### Database
- **Engine**: PostgreSQL
- **Vector Extension**: pgvector (1536-dimensional embeddings)
- **Hosting**: Supabase

### Deployment
- **Backend**: Vercel (serverless functions)
- **Frontend**: Vercel (static SPA)
- **Database**: Supabase (managed PostgreSQL)

---

## 8. File-to-Feature Mapping

This section explicitly maps every feature/functionality to the files responsible for implementing it.

### 8.1 Authentication & Authorization

| Feature | Files | Description |
|---------|-------|-------------|
| **Login (username/password)** | [`backend/controllers/auth.controller.js`](backend/controllers/auth.controller.js) (login) | Validates credentials with bcrypt, issues JWT, creates session record |
| **JWT Verification** | [`backend/middleware/auth.js`](backend/middleware/auth.js) (requireAuth) | Verifies JWT, checks `is_active` status and `expires_at` |
| **Admin Guard** | [`backend/middleware/auth.js`](backend/middleware/auth.js) (requireAdmin) | Role-based access control for admin routes |
| **Session Management** | [`backend/controllers/auth.controller.js`](backend/controllers/auth.controller.js) (login/logout) | Creates/invalidates session records in `sessions` table |
| **Token Quota Check** | [`backend/middleware/tokenCheck.js`](backend/middleware/tokenCheck.js) | Blocks requests when `used_tokens >= total_tokens` |
| **Login UI** | [`frontend/src/pages/LoginPage.jsx`](frontend/src/pages/LoginPage.jsx) | Login form with remember-me toggle and anonymous mode button |
| **Auth State (Frontend)** | [`frontend/src/context/AuthContext.jsx`](frontend/src/context/AuthContext.jsx) | Global auth state, session restore from localStorage/sessionStorage |
| **Auth API Client** | [`frontend/src/config/api.js`](frontend/src/config/api.js) | Axios instance with JWT interceptor, 401 auto-redirect |

### 8.2 Chat Pipeline (Core)

| Feature | Files | Description |
|---------|-------|-------------|
| **Chat Route & Rate Limiting** | [`backend/routes/chat.routes.js`](backend/routes/chat.routes.js) | POST `/message` (30/min limit), POST `/stream` (SSE), GET `/models` |
| **Chat Controller (8-step pipeline)** | [`backend/controllers/chat.controller.js`](backend/controllers/chat.controller.js) (sendMessage) | Orchestrates: compress → cache → RAG → history → AI dispatch → token tracking → save → analytics |
| **Prompt Compression** | [`backend/services/compress.service.js`](backend/services/compress.service.js) | Strips filler words (please, kindly, can you, etc.) |
| **Query Compression (LLM)** | [`backend/services/context.service.js`](backend/services/context.service.js) (maybeCompressQuery) | Gemini Flash compresses long queries (>300 words) |
| **Two-Tier Caching** | [`backend/services/cache.service.js`](backend/services/cache.service.js) | Exact match (SHA-256 hash) + Semantic match (pgvector, 0.92 threshold) |
| **RAG Context Building** | [`backend/services/rag.service.js`](backend/services/rag.service.js) (buildRAGContext) | Semantic document search + context block construction |
| **History/Memory Context** | [`backend/services/context.service.js`](backend/services/context.service.js) (buildContextMessages) | Summarized mode (auto-compress) vs Accurate mode (raw history) |
| **AI Dispatch** | [`backend/services/ai/dispatcher.service.js`](backend/services/ai/dispatcher.service.js) (dispatchToAI) | Routes to correct provider based on model config |
| **Token Budgeting** | [`backend/services/tokenBudget.service.js`](backend/services/tokenBudget.service.js) | Static + dynamic budget allocation, complexity scoring |
| **Analytics Logging** | [`backend/services/analytics.service.js`](backend/services/analytics.service.js) (logAnalytics) | Logs every query to `query_analytics` table |
| **Streaming (SSE)** | [`backend/routes/chat.routes.js`](backend/routes/chat.routes.js) (POST /stream) | Server-Sent Events for real-time token streaming |
| **Abort/Cancellation** | [`backend/controllers/chat.controller.js`](backend/controllers/chat.controller.js) (AbortController) | Client can cancel AI generation mid-response |

### 8.3 AI Provider Integrations

| Feature | Files | Description |
|---------|-------|-------------|
| **Model Registry** | [`backend/config/models.js`](backend/config/models.js) | Central config for all 20+ models across 10 providers |
| **Google Gemini** | [`backend/services/ai/gemini.service.js`](backend/services/ai/gemini.service.js) | Google AI SDK, AbortSignal support, system instructions |
| **Groq (LLaMA)** | [`backend/services/ai/groq.service.js`](backend/services/ai/groq.service.js) | Groq SDK for ultra-fast inference |
| **Mistral** | [`backend/services/ai/mistral.service.js`](backend/services/ai/mistral.service.js) | Mistral API + embeddings (1024→1536 padded) |
| **Cohere** | [`backend/services/ai/cohere.service.js`](backend/services/ai/cohere.service.js) | Cohere chat API with chat_history separation |
| **OpenAI (GPT)** | [`backend/services/ai/openai.service.js`](backend/services/ai/openai.service.js) | OpenAI SDK with cache token tracking |
| **Anthropic Claude** | [`backend/services/ai/claude.service.js`](backend/services/ai/claude.service.js) | Anthropic SDK with prompt caching (cache_control: ephemeral) |
| **DeepSeek** | [`backend/services/ai/deepseek.service.js`](backend/services/ai/deepseek.service.js) | DeepSeek API via axios |
| **OpenRouter** | [`backend/services/ai/openrouter.service.js`](backend/services/ai/openrouter.service.js) | Aggregator — multiple models via single API |
| **Together AI** | [`backend/services/ai/together.service.js`](backend/services/ai/together.service.js) | Together AI API |
| **AnyAPI** | [`backend/services/ai/anyapi.service.js`](backend/services/ai/anyapi.service.js) | Alternative API gateway |
| **Unified Provider Caller** | [`backend/services/ai/unified.service.js`](backend/services/ai/unified.service.js) | Shared OpenAI-compatible HTTP caller for OpenRouter/Together/AnyAPI |
| **Live Model Catalog** | [`backend/services/modelCatalog.service.js`](backend/services/modelCatalog.service.js) | Fetches live model lists from providers with 6-hour cache TTL |

### 8.4 RAG (Retrieval-Augmented Generation)

| Feature | Files | Description |
|---------|-------|-------------|
| **Embedding Generation** | [`backend/services/rag.service.js`](backend/services/rag.service.js) (embedText) | Multi-provider embeddings (OpenRouter/Mistral/Gemini/OpenAI) with 1hr TTL cache |
| **Document Search** | [`backend/services/rag.service.js`](backend/services/rag.service.js) (searchRelevantDocs) | pgvector cosine similarity search via `match_documents` RPC |
| **RAG Context Builder** | [`backend/services/rag.service.js`](backend/services/rag.service.js) (buildRAGContext) | Builds context block within token budget |
| **File Upload Pipeline** | [`backend/services/fileUpload.service.js`](backend/services/fileUpload.service.js) (processUploadedFile) | Extracts text, generates embeddings, stores in RAG |
| **File RAG Search** | [`backend/services/fileUpload.service.js`](backend/services/fileUpload.service.js) (searchUserFilesRAG) | Cosine similarity search across user's uploaded files |
| **Upload Routes** | [`backend/routes/upload.routes.js`](backend/routes/upload.routes.js) | POST /file (multer, 50MB), GET /search, DELETE /:fileId |
| **Database RAG Functions** | [`database/schema.sql`](database/schema.sql) | `match_documents`, `search_uploaded_files` PostgreSQL functions |

### 8.5 File Processing

| Feature | Files | Description |
|---------|-------|-------------|
| **Text Extraction** | [`backend/services/fileUpload.service.js`](backend/services/fileUpload.service.js) (extractTextFromBuffer) | PDF (pdf-parse), DOCX (mammoth), TXT, images (vision API), ZIP (jszip), code files |
| **LLM File Analysis** | [`backend/services/fileUpload.service.js`](backend/services/fileUpload.service.js) (analyzFileWithLLM) | Uses OpenRouter to analyze extracted file content |
| **ZIP Processing** | [`backend/services/fileUpload.service.js`](backend/services/fileUpload.service.js) (processZipFile) | Extracts and processes multiple files from ZIP archives |
| **File Upload UI** | [`frontend/src/components/chat/FileUpload.jsx`](frontend/src/components/chat/FileUpload.jsx) | Paperclip button, file input for multiple formats |
| **Image Paste** | [`frontend/src/pages/ChatPage.jsx`](frontend/src/pages/ChatPage.jsx) (handlePaste) | Paste images for vision-capable models |

### 8.6 Memory & Context Management

| Feature | Files | Description |
|---------|-------|-------------|
| **Summarized Mode** | [`backend/services/context.service.js`](backend/services/context.service.js) (buildContextMessages) | Auto-compresses old messages via Gemini Flash |
| **Accurate Mode** | [`backend/services/context.service.js`](backend/services/context.service.js) (buildContextMessages) | Keeps full raw conversation history |
| **Multi-Provider Summarization** | [`backend/services/summary.service.js`](backend/services/summary.service.js) (summarizeMemory) | Fallback chain: OpenRouter → Gemini → Mistral → Cerebras → local truncation |
| **Topic Similarity Detection** | [`backend/services/similarity.service.js`](backend/services/similarity.service.js) (isSameTopic) | TF-IDF/Jaccard similarity for topic deduplication |
| **Smart Context Trimming** | [`backend/services/tokenBudget.service.js`](backend/services/tokenBudget.service.js) (smartTrimContextBlock) | Structure-aware trimming preserving summary vs latest sections |
| **Memory Mode UI** | [`frontend/src/pages/ChatPage.jsx`](frontend/src/pages/ChatPage.jsx) | Summarized+ / Accurate+ toggle buttons |

### 8.7 History & Topics

| Feature | Files | Description |
|---------|-------|-------------|
| **Topic CRUD** | [`backend/controllers/history.controller.js`](backend/controllers/history.controller.js) | List topics, get messages, delete topic (cascade), rename topic |
| **History Routes** | [`backend/routes/history.routes.js`](backend/routes/history.routes.js) | GET /topics, GET /topics/:id/messages, DELETE /topics/:id, PATCH /topics/:id |
| **Sidebar (Topic List)** | [`frontend/src/components/chat/Sidebar.jsx`](frontend/src/components/chat/Sidebar.jsx) | Topic list with rename/delete, new chat button |
| **Message Display** | [`frontend/src/components/chat/MessageBubble.jsx`](frontend/src/components/chat/MessageBubble.jsx) | Markdown rendering with syntax highlighting |

### 8.8 Admin & Analytics

| Feature | Files | Description |
|---------|-------|-------------|
| **Admin Controller** | [`backend/controllers/admin.controller.js`](backend/controllers/admin.controller.js) | User CRUD, token reset, analytics queries |
| **Admin Routes** | [`backend/routes/admin.routes.js`](backend/routes/admin.routes.js) | Protected admin endpoints |
| **Admin Dashboard UI** | [`frontend/src/pages/AdminPage.jsx`](frontend/src/pages/AdminPage.jsx) | User table, analytics charts (recharts), API status |
| **User Modal** | [`frontend/src/components/admin/UserModal.jsx`](frontend/src/components/admin/UserModal.jsx) | Create/edit user form |
| **Analytics Data** | [`backend/services/analytics.service.js`](backend/services/analytics.service.js) | Model counts, top queries, daily usage, cache hit rate |

### 8.9 Token Management

| Feature | Files | Description |
|---------|-------|-------------|
| **Token Budget Calculation** | [`backend/services/tokenBudget.service.js`](backend/services/tokenBudget.service.js) (createDynamicPromptBudget) | Dynamic allocation based on turn count + complexity score |
| **Complexity Scoring** | [`backend/services/tokenBudget.service.js`](backend/services/tokenBudget.service.js) (calculateComplexityScore) | SAP/technical keyword detection for budget adjustment |
| **Token Deduction** | [`backend/controllers/chat.controller.js`](backend/controllers/chat.controller.js) (sendMessage) | Deducts tokens from user's `used_tokens` |
| **Token Quota Middleware** | [`backend/middleware/tokenCheck.js`](backend/middleware/tokenCheck.js) | Blocks requests when quota exceeded |
| **Token Progress Bar** | [`frontend/src/components/layout/TokenBar.jsx`](frontend/src/components/layout/TokenBar.jsx) | Visual progress bar (green < 60%, amber < 85%, red ≥ 85%) |

### 8.10 Anonymous Mode

| Feature | Files | Description |
|---------|-------|-------------|
| **Anonymous Chat Page** | [`frontend/src/pages/AnonymousPage.jsx`](frontend/src/pages/AnonymousPage.jsx) | No-login chat with sessionStorage persistence |
| **Anonymous Route** | [`frontend/src/App.jsx`](frontend/src/App.jsx) | `/anonymous` path mapped to AnonymousPage |

### 8.11 Model Selection

| Feature | Files | Description |
|---------|-------|-------------|
| **Model Selector UI** | [`frontend/src/components/chat/ModelSelector.jsx`](frontend/src/components/chat/ModelSelector.jsx) | Provider-grouped dropdown with free/paid badges |
| **Unified Provider Modal** | [`frontend/src/components/chat/UnifiedModelModal.jsx`](frontend/src/components/chat/UnifiedModelModal.jsx) | Search + refresh for OpenRouter/Together/AnyAPI sub-models |
| **Model List API** | [`backend/routes/chat.routes.js`](backend/routes/chat.routes.js) (GET /models) | Returns all models from config |
| **Provider Models API** | [`backend/routes/chat.routes.js`](backend/routes/chat.routes.js) (GET /provider-models/:provider) | Live catalog from modelCatalog.service |

### 8.12 Database & Schema

| Feature | Files | Description |
|---------|-------|-------------|
| **Full Schema** | [`database/schema.sql`](database/schema.sql) | 9 tables, 4 PostgreSQL functions, IVFFLAT indexes, RLS policies |
| **Token Optimization Migration** | [`database/token_optimization.sql`](database/token_optimization.sql) | Adds `query_embedding` column and `match_query_cache` function |
| **Supabase Client** | [`backend/config/supabase.js`](backend/config/supabase.js) | Client with `service_role` key (bypasses RLS) |

### 8.13 Frontend Routing & Layout

| Feature | Files | Description |
|---------|-------|-------------|
| **App Routing** | [`frontend/src/App.jsx`](frontend/src/App.jsx) | React Router v6 with ProtectedRoute wrapper |
| **Main Chat UI** | [`frontend/src/pages/ChatPage.jsx`](frontend/src/pages/ChatPage.jsx) | Full chat interface with all controls |
| **Mobile Navigation** | [`frontend/src/components/chat/MobileNav.jsx`](frontend/src/components/chat/MobileNav.jsx) | Mobile sidebar drawer |
| **CSS Styles** | [`frontend/src/index.css`](frontend/src/index.css) + component CSS files | Styling for all components |

### 8.14 Server & Deployment

| Feature | Files | Description |
|---------|-------|-------------|
| **Express Server** | [`backend/server.js`](backend/server.js) | Entry point with helmet, morgan, cors, route mounting |
| **Backend Vercel Config** | [`backend/vercel.json`](backend/vercel.json) | Serverless function configuration |
| **Frontend Vercel Config** | [`frontend/vercel.json`](frontend/vercel.json) | SPA deployment configuration |
| **Root Package** | [`package.json`](package.json) | Monorepo scripts |
| **Environment Template** | [`backend/.env.example`](backend/.env.example), [`frontend/.env.example`](frontend/.env.example) | Environment variable templates |
