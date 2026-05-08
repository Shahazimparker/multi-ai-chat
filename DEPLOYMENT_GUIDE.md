# MultiAI Chat — Complete Deployment & Maintenance Guide
> **Beginner-friendly.** Read top to bottom for a first-time deploy.  
> Estimated setup time: **30–45 minutes**

---

## Table of Contents
1. [Project Overview](#1-project-overview)
2. [File Map — What Every File Does](#2-file-map)
3. [Prerequisites](#3-prerequisites)
4. [Step 1 — Clone & Install](#4-step-1--clone--install)
5. [Step 2 — Supabase Setup (Database)](#5-step-2--supabase-database-setup)
6. [Step 3 — Get AI API Keys](#6-step-3--get-ai-api-keys)
7. [Step 4 — Configure .env Files](#7-step-4--configure-env-files)
8. [Step 5 — Run Locally](#8-step-5--run-locally)
9. [Step 6 — Deploy Backend to Vercel](#9-step-6--deploy-backend-to-vercel)
10. [Step 7 — Deploy Frontend to Vercel](#10-step-7--deploy-frontend-to-vercel)
11. [Step 8 — First Login](#11-step-8--first-login)
12. [How to Add a New AI Model](#12-how-to-add-a-new-ai-model)
13. [How to Adjust Business Rules](#13-how-to-adjust-business-rules)
14. [Common Errors & Fixes](#14-common-errors--fixes)
15. [GitHub Version Control Workflow](#15-github-version-control-workflow)

---

## 1. Project Overview

```
MultiAI Chat
├── frontend/     React app (deployed to Vercel)
├── backend/      Node.js/Express API (deployed to Vercel)
└── database/     SQL schema (run once in Supabase)
```

**What it does:**
- 8 AI models in one chat UI (Gemini, Groq, Mistral, Cohere, GPT-4o, Claude)
- Admin creates users, sets token quotas, session limits, expiry
- Chat history saved per-topic for logged-in users
- Anonymous mode: session-only, nothing saved to DB
- Smart context: sends last 10 messages summary to AI if same topic
- Query cache: repeated queries served instantly without calling AI
- RAG: vector search in your knowledge base injected into prompt
- Prompt compression: removes filler words to save tokens

---

## 2. File Map

### Backend (`backend/`)

| File | What it does | When to change |
|------|-------------|----------------|
| `server.js` | Express app entry, registers middleware & routes | Change PORT |
| `config/supabase.js` | Supabase client (service_role) | Never (uses .env) |
| `config/models.js` | **All AI models defined here** | Add/remove AI models |
| `middleware/auth.js` | JWT verification, admin guard | Rarely |
| `middleware/tokenCheck.js` | Blocks over-quota users | Rarely |
| `controllers/auth.controller.js` | Login, logout, /me endpoint | Rarely |
| `controllers/chat.controller.js` | **Core chat logic** (cache→RAG→context→AI) | Tweak chat behavior |
| `controllers/admin.controller.js` | User CRUD, analytics API | Add admin features |
| `controllers/history.controller.js` | Fetch/delete/rename topics | Rarely |
| `routes/*.routes.js` | Maps URLs to controllers | Add new endpoints |
| `services/ai/dispatcher.service.js` | Routes to correct AI provider | Add new providers |
| `services/ai/gemini.service.js` | Calls Google Gemini | Model version updates |
| `services/ai/groq.service.js` | Calls Groq | Model version updates |
| `services/ai/mistral.service.js` | Calls Mistral | Model version updates |
| `services/ai/cohere.service.js` | Calls Cohere | Model version updates |
| `services/ai/openai.service.js` | Calls OpenAI | Model version updates |
| `services/ai/claude.service.js` | Calls Anthropic Claude | Model version updates |
| `services/compress.service.js` | Strips filler words from prompts | Add more patterns |
| `services/similarity.service.js` | TF-IDF topic comparison | Adjust threshold |
| `services/context.service.js` | Summarizes history with Gemini Flash | Tweak summary prompt |
| `services/cache.service.js` | Query caching in Supabase | Adjust cache logic |
| `services/rag.service.js` | pgvector semantic search | Adjust similarity threshold |

### Frontend (`frontend/src/`)

| File | What it does | When to change |
|------|-------------|----------------|
| `index.js` | React entry point | Never |
| `App.jsx` | Router, auth guard | Add new pages |
| `config/api.js` | Axios instance with JWT interceptor | Change API base URL |
| `context/AuthContext.jsx` | Global user/token state | Rarely |
| `pages/LoginPage.jsx` | Login form + anonymous button | Branding changes |
| `pages/ChatPage.jsx` | **Main chat interface** | UI changes |
| `pages/AnonymousPage.jsx` | Anonymous mode chat | UI changes |
| `pages/AdminPage.jsx` | Admin dashboard (users + analytics) | Add admin features |
| `components/chat/ModelSelector.jsx` | AI model dropdown | Add provider colors |
| `components/chat/Sidebar.jsx` | Chat history sidebar | UI changes |
| `components/chat/MessageBubble.jsx` | Individual message rendering | Markdown/styling |
| `components/layout/TokenBar.jsx` | Token usage display bar | Styling |
| `components/admin/UserModal.jsx` | Create/edit user form | Add user fields |

### Database (`database/`)

| File | What it does |
|------|-------------|
| `schema.sql` | **Run this once in Supabase SQL Editor** |

---

## 3. Prerequisites

Install these on your computer:

- **Node.js 18+** → https://nodejs.org (choose LTS)
- **Git** → https://git-scm.com
- **Vercel CLI** → `npm install -g vercel`
- A **GitHub account** → https://github.com
- A **Supabase account** (free) → https://supabase.com

---

## 4. Step 1 — Clone & Install

```bash
# Clone your repo (after pushing to GitHub)
git clone https://github.com/YOUR_USERNAME/multi-ai-chat.git
cd multi-ai-chat

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

---

## 5. Step 2 — Supabase Database Setup

1. Go to https://supabase.com → **New Project**
2. Choose a name (e.g. `multi-ai-chat`) and a **strong database password** (save it!)
3. Select the region closest to you → **Create Project**
4. Wait ~2 minutes for the project to spin up
5. In the left sidebar → **SQL Editor** → **New Query**
6. Open the file `database/schema.sql` from this project
7. **Paste the entire contents** into the SQL editor → click **Run**
8. You should see "Success" — all tables are now created

**Get your Supabase credentials:**
- Left sidebar → **Settings** → **API**
- Copy **Project URL** → this is `SUPABASE_URL`
- Under "Project API keys" → copy **service_role** (secret) → this is `SUPABASE_SERVICE_KEY`
- ⚠️ Never expose `service_role` key in frontend code

---

## 6. Step 3 — Get AI API Keys

Get only the ones you need (at minimum get **Gemini** as it's used for summarization):

| Provider | Where to get key | Cost |
|----------|-----------------|------|
| **Gemini** (required) | https://aistudio.google.com/app/apikey | Free |
| Groq | https://console.groq.com → API Keys | Free |
| Mistral | https://console.mistral.ai → API Keys | Free tier |
| Cohere | https://dashboard.cohere.com → API Keys | Free trial |
| OpenAI | https://platform.openai.com → API Keys | Paid |
| Anthropic (Claude) | https://console.anthropic.com → API Keys | Paid |

---

## 7. Step 4 — Configure .env Files

### Backend `.env`
Create file: `backend/.env` (copy from `backend/.env.example`)

```env
PORT=5000
FRONTEND_URL=http://localhost:3000

JWT_SECRET=make-this-very-long-and-random-at-least-32-chars

SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGci...your-service-role-key...

GEMINI_API_KEY=AIzaSy...
GROQ_API_KEY=gsk_...
MISTRAL_API_KEY=...
COHERE_API_KEY=...
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

> **JWT_SECRET tip:** Generate a strong secret:  
> `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

### Frontend `.env.local`
Create file: `frontend/.env.local` (copy from `frontend/.env.example`)

```env
REACT_APP_API_URL=http://localhost:5000/api
```

---

## 8. Step 5 — Run Locally

Open **two terminal windows:**

**Terminal 1 — Backend:**
```bash
cd backend
npm run dev
# Should print: ✅ Server running on port 5000
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm start
# Opens http://localhost:3000 automatically
```

**Login with default admin:**
- Username: `admin`
- Password: `Admin@1234`
- ⚠️ **Change this password immediately** in Admin Panel → Users → Edit

---

## 9. Step 6 — Deploy Backend to Vercel

```bash
cd backend

# Login to Vercel
vercel login

# Deploy (follow prompts)
vercel

# When asked:
# - "Set up and deploy?" → Y
# - "Which scope?" → your account
# - "Link to existing project?" → N
# - "What's your project name?" → multi-ai-chat-backend
# - "In which directory is your code?" → ./  (just press Enter)
# - "Override settings?" → N

# After deploy, copy the URL (e.g. https://multi-ai-chat-backend.vercel.app)
```

**Add environment variables to Vercel:**
```bash
# Run these one by one OR use Vercel dashboard
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_KEY
vercel env add JWT_SECRET
vercel env add GEMINI_API_KEY
vercel env add GROQ_API_KEY
vercel env add MISTRAL_API_KEY
vercel env add COHERE_API_KEY
vercel env add OPENAI_API_KEY
vercel env add ANTHROPIC_API_KEY
vercel env add FRONTEND_URL   # set to your frontend Vercel URL (after step 7)

# Redeploy after adding env vars
vercel --prod
```

> 💡 **Easier alternative:** Go to Vercel Dashboard → your backend project →  
> **Settings → Environment Variables** → add them all there → then **Redeploy**

---

## 10. Step 7 — Deploy Frontend to Vercel

```bash
cd frontend

# Build and deploy
vercel

# When prompted for project name: multi-ai-chat-frontend
```

**Add environment variable:**
- Vercel Dashboard → frontend project → Settings → Environment Variables
- Add: `REACT_APP_API_URL` = `https://multi-ai-chat-backend.vercel.app/api`
- Redeploy: `vercel --prod`

**Update CORS in backend:**
- Vercel Dashboard → backend project → Settings → Environment Variables
- Update `FRONTEND_URL` = `https://multi-ai-chat-frontend.vercel.app`
- Redeploy backend: `cd backend && vercel --prod`

---

## 11. Step 8 — First Login

1. Go to your frontend Vercel URL
2. Login: `admin` / `Admin@1234`
3. Go to **Admin Panel** (gear icon in sidebar)
4. **Users → Edit admin** → change the password!
5. Create your first regular user: **Users → Create User**
6. Fill: username, email, password, token quota (e.g. 100000), session 60 min

---

## 12. How to Add a New AI Model

**Only 2 files to edit:**

### Step A — Add model to `backend/config/models.js`
```js
'my-new-model': {
  label:    'My New Model (Free)',
  provider: 'groq',           // use existing provider OR add new one
  apiKey:   process.env.MY_API_KEY,
  model:    'actual-model-name-from-provider',
  paid:     false,
  maxTokens: 4096,
},
```

### Step B — (Only if new provider) Add service file
Create `backend/services/ai/myprovider.service.js`:
```js
const callMyProvider = async (modelName, apiKey, messages) => {
  // call your API here
  return { text: '...response...', tokensUsed: 100 };
};
module.exports = { callMyProvider };
```

Then register in `backend/services/ai/dispatcher.service.js`:
```js
const { callMyProvider } = require('./myprovider.service');
// inside switch:
case 'myprovider': return callMyProvider(model, apiKey, messages);
```

**That's it!** The frontend model dropdown auto-reads from the backend.

---

## 13. How to Adjust Business Rules

| What to change | File | What to edit |
|----------------|------|-------------|
| Remove filler words from prompts | `backend/services/compress.service.js` | Add to `FILLER_PATTERNS` array |
| Topic similarity sensitivity | `backend/services/similarity.service.js` | Change `threshold` (0.0–1.0) in `isSameTopic()` |
| How many history messages to send | `backend/services/context.service.js` | Change `limit = 10` in `getRecentMessages()` |
| Summary prompt (what Gemini summarizes) | `backend/services/context.service.js` | Edit the string in `summarizeWithGemini()` |
| Rate limiting (requests/minute) | `backend/routes/chat.routes.js` | Change `max: 30` in `chatLimiter` |
| Default token quota for new users | `backend/controllers/admin.controller.js` | Change `total_tokens = 100000` |
| RAG similarity threshold | `backend/services/rag.service.js` | Change `threshold = 0.4` in `searchRelevantDocs()` |
| Cache skip (short responses) | `backend/services/cache.service.js` | Change `response.length < 20` |

---

## 14. Common Errors & Fixes

### "CORS error" in browser
- Make sure `FRONTEND_URL` in backend .env matches your frontend URL **exactly** (no trailing slash)
- Redeploy backend after changing

### "Token not found" / keeps logging out
- `JWT_SECRET` must be the **same** in both local `.env` and Vercel environment variables
- Make sure it's at least 32 characters

### "Gemini API error: invalid key"
- `GEMINI_API_KEY` must start with `AIzaSy...`
- Check Google AI Studio → your key is active

### "pgvector extension not found"
- In Supabase SQL Editor, run: `CREATE EXTENSION IF NOT EXISTS vector;`
- This must be run before the schema

### "relation 'users' does not exist"
- You haven't run `database/schema.sql` yet in Supabase
- Go to Supabase → SQL Editor → paste & run the full schema file

### Chat says "API key not configured"
- The provider's API key is missing from your `.env` file
- Add it and restart the backend (or redeploy on Vercel)

### Frontend shows blank page on Vercel
- Check that `frontend/vercel.json` exists and has the SPA rewrite rule
- Check Vercel build logs for errors

### Admin login fails with correct password
- The default password hash in schema.sql is for `Admin@1234`
- If you changed the seed SQL, ensure the hash matches your password
- To generate a new hash: `node -e "const b=require('bcryptjs'); b.hash('YourPassword',12).then(console.log)"`

---

## 15. GitHub Version Control Workflow

### Initial push
```bash
cd multi-ai-chat
git init
git add .
git commit -m "feat: initial MultiAI Chat platform"
git remote add origin https://github.com/YOUR_USERNAME/multi-ai-chat.git
git branch -M main
git push -u origin main
```

### Daily workflow
```bash
git pull origin main              # always pull first
# make your changes...
git add .
git commit -m "fix: describe what you changed"
git push origin main
```

### Recommended branch strategy
```bash
# For new features — never code directly on main
git checkout -b feature/add-new-model
# make changes...
git push origin feature/add-new-model
# Create Pull Request on GitHub → Merge → main auto-deploys on Vercel
```

### Connect Vercel to GitHub (auto-deploy)
1. Vercel Dashboard → your project → **Settings → Git**
2. Connect your GitHub repo
3. Set **Production Branch** = `main`
4. Now every push to `main` auto-deploys! 🚀

---

## Environment Variables Quick Reference

### Backend `.env` (all required)
```
PORT                  Server port (5000 for local)
FRONTEND_URL          Exact frontend URL for CORS
JWT_SECRET            Long random string (32+ chars)
SUPABASE_URL          Your Supabase project URL
SUPABASE_SERVICE_KEY  Supabase service_role secret key
GEMINI_API_KEY        Google AI Studio key (required — used for summaries)
GROQ_API_KEY          Groq console key (optional)
MISTRAL_API_KEY       Mistral console key (optional)
COHERE_API_KEY        Cohere dashboard key (optional)
OPENAI_API_KEY        OpenAI platform key (optional)
ANTHROPIC_API_KEY     Anthropic console key (optional)
```

### Frontend `.env.local` / Vercel
```
REACT_APP_API_URL     Full backend API URL (ending in /api)
```

---

*Built with: React 18, Node.js/Express, Supabase/PostgreSQL, pgvector, Vercel*
