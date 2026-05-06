# MultiAI Chat Platform — Complete Guide
## Deployment, Maintenance & File Reference

---

## 📁 PROJECT STRUCTURE

```
multi-ai-chat/
│
├── backend/                        # Node.js + Express API server
│   ├── server.js                   ★ Entry point — registers all routes
│   ├── vercel.json                 ★ Vercel deployment config for backend
│   ├── package.json                  NPM dependencies list
│   ├── .env.example                ★ Copy to .env and fill API keys
│   │
│   ├── config/
│   │   ├── supabase.js             ★ Supabase DB client (uses service_role key)
│   │   └── models.js               ★ ALL AI models defined here — add/remove models
│   │
│   ├── middleware/
│   │   ├── auth.js                   JWT verification + account checks
│   │   └── tokenCheck.js             Blocks request if user token quota exceeded
│   │
│   ├── routes/
│   │   ├── auth.routes.js            /api/auth/* endpoints
│   │   ├── chat.routes.js            /api/chat/* endpoints
│   │   ├── admin.routes.js           /api/admin/* endpoints (admin only)
│   │   └── history.routes.js         /api/history/* endpoints
│   │
│   ├── controllers/
│   │   ├── auth.controller.js        Login / logout / get-me logic
│   │   ├── chat.controller.js      ★ Core chat logic — all AI pipeline here
│   │   ├── admin.controller.js       User CRUD + analytics queries
│   │   └── history.controller.js     Topic/message fetch, rename, delete
│   │
│   └── services/
│       ├── compress.service.js     ★ Strips filler words from prompts
│       ├── similarity.service.js   ★ Jaccard similarity for topic detection
│       ├── context.service.js      ★ History summarization via Gemini Flash
│       ├── cache.service.js        ★ Query result caching in Supabase
│       ├── rag.service.js          ★ Vector search (RAG) via pgvector
│       └── ai/
│           ├── dispatcher.service.js ★ Routes to correct AI provider
│           ├── gemini.service.js     Google Gemini API calls
│           ├── groq.service.js       Groq API calls
│           ├── mistral.service.js    Mistral AI API calls
│           ├── cohere.service.js     Cohere API calls
│           ├── openai.service.js     OpenAI GPT API calls
│           └── claude.service.js     Anthropic Claude API calls
│
├── frontend/                       # React app
│   ├── public/
│   │   └── index.html              Base HTML template
│   │
│   ├── src/
│   │   ├── index.jsx               React DOM entry point
│   │   ├── index.css               Global reset + dark theme base
│   │   ├── App.jsx               ★ Router setup + route guards
│   │   │
│   │   ├── config/
│   │   │   └── api.js            ★ Axios instance with JWT auto-attach
│   │   │
│   │   ├── context/
│   │   │   └── AuthContext.jsx   ★ Global auth state (user, login, logout)
│   │   │
│   │   ├── pages/
│   │   │   ├── LoginPage.jsx     ★ Login form + anonymous entry point
│   │   │   ├── LoginPage.css
│   │   │   ├── ChatPage.jsx      ★ Main chat interface
│   │   │   ├── ChatPage.css
│   │   │   ├── AnonymousPage.jsx ★ Session-only chat (no DB save)
│   │   │   ├── AnonymousPage.css
│   │   │   ├── AdminPage.jsx     ★ Admin dashboard (users + analytics)
│   │   │   └── AdminPage.css
│   │   │
│   │   └── components/
│   │       ├── layout/
│   │       │   ├── TokenBar.jsx    Token usage bar (top of chat)
│   │       │   └── TokenBar.css
│   │       ├── chat/
│   │       │   ├── Sidebar.jsx     Chat history sidebar
│   │       │   ├── Sidebar.css
│   │       │   ├── ModelSelector.jsx ★ AI model dropdown
│   │       │   ├── ModelSelector.css
│   │       │   ├── MessageBubble.jsx  Message with markdown rendering
│   │       │   └── MessageBubble.css
│   │       └── admin/
│   │           ├── UserModal.jsx   Create/Edit user form modal
│   │           └── UserModal.css
│   │
│   ├── package.json
│   └── .env.example              ★ Frontend env vars (API URL)
│
├── database/
│   └── schema.sql                ★ Run this ONCE in Supabase SQL Editor
│
├── .gitignore
├── package.json                  Root convenience scripts
└── GUIDE.md                      This file
```

---

## 🚀 STEP-BY-STEP DEPLOYMENT

### STEP 1 — Create Supabase Project

1. Go to https://supabase.com → New Project
2. Note your **Project URL** and **service_role key** (Settings → API)
3. Go to **SQL Editor** → paste entire contents of `database/schema.sql` → Run
4. Verify tables created: users, sessions, topics, messages, query_cache, query_analytics, rag_documents
5. Default admin user created: email `admin@multiai.com` / password `Admin@1234`
   **⚠️ Change this password immediately after first login!**

---

### STEP 2 — Get API Keys (free ones first)

| Provider    | URL                                      | Key Variable         | Cost  |
|-------------|------------------------------------------|----------------------|-------|
| Google Gemini| https://aistudio.google.com/app/apikey  | GEMINI_API_KEY       | Free  |
| Groq        | https://console.groq.com/keys            | GROQ_API_KEY         | Free  |
| Mistral     | https://console.mistral.ai/api-keys      | MISTRAL_API_KEY      | Free  |
| Cohere      | https://dashboard.cohere.com/api-keys    | COHERE_API_KEY       | Free trial |
| OpenAI      | https://platform.openai.com/api-keys     | OPENAI_API_KEY       | Paid  |
| Anthropic   | https://console.anthropic.com/api-keys   | ANTHROPIC_API_KEY    | Paid  |

> You can leave paid API keys empty — those models will show an error if selected.

---

### STEP 3 — Deploy Backend to Vercel

```bash
# 1. Install Vercel CLI
npm install -g vercel

# 2. Go to backend folder
cd backend

# 3. Login to Vercel
vercel login

# 4. Deploy (first time — follow prompts)
vercel

# 5. Set environment variables on Vercel dashboard:
#    Project Settings → Environment Variables → Add all from .env.example
#    Or use CLI:
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_KEY
vercel env add JWT_SECRET
vercel env add GEMINI_API_KEY
# ... repeat for all keys

# 6. Redeploy to apply env vars
vercel --prod
```

Note your backend URL: `https://your-backend-name.vercel.app`

---

### STEP 4 — Deploy Frontend to Vercel

```bash
# 1. Go to frontend folder
cd frontend

# 2. Create .env file
cp .env.example .env
# Edit .env:
# REACT_APP_API_URL=https://your-backend-name.vercel.app/api

# 3. Build and deploy
vercel

# 4. Set environment variable on Vercel:
#    REACT_APP_API_URL = https://your-backend-name.vercel.app/api
```

---

### STEP 5 — Update CORS

In backend Vercel dashboard → Environment Variables:
```
FRONTEND_URL = https://your-frontend-name.vercel.app
```
Then redeploy backend: `vercel --prod`

---

### STEP 6 — First Login

1. Open your frontend URL
2. Login with: `admin` / `Admin@1234`
3. Go to Admin panel → Edit admin user → Change password
4. Create regular users as needed

---

## 🔧 HOW TO MAKE COMMON CHANGES

### Add a New AI Model

Edit `backend/config/models.js`:
```javascript
'my-new-model': {
  label:    'My New Model (Free)',
  provider: 'groq',           // use existing provider name
  apiKey:   process.env.GROQ_API_KEY,
  model:    'actual-model-id-from-provider',
  paid:     false,
  maxTokens: 4096,
},
```
The frontend dropdown will **automatically** show the new model. No frontend changes needed.

---

### Add a New AI Provider

1. Create `backend/services/ai/myprovider.service.js`:
```javascript
const callMyProvider = async (modelName, apiKey, messages) => {
  // call their API here
  return { text: 'response', tokensUsed: 100 };
};
module.exports = { callMyProvider };
```

2. Register it in `backend/services/ai/dispatcher.service.js`:
```javascript
const { callMyProvider } = require('./myprovider.service');
// inside switch:
case 'myprovider': return callMyProvider(model, apiKey, messages);
```

3. Add models in `backend/config/models.js` using `provider: 'myprovider'`

---

### Change Similarity Threshold (History Context)

Edit `backend/services/similarity.service.js`:
```javascript
// Line: const isSameTopic = (newQuery, recentMessages = [], threshold = 0.2)
// Change 0.2 to:
//   0.1 = very loose (almost always uses history)
//   0.3 = moderate
//   0.5 = strict (only very similar queries get history)
```

---

### Change How Many History Messages Are Sent

Edit `backend/services/context.service.js`:
```javascript
const getRecentMessages = async (topicId, limit = 10)
//                                               ^^^^ change this
```

---

### Change Cache Behavior

To **disable caching** entirely, edit `backend/controllers/chat.controller.js`:
```javascript
// Comment out these two lines:
// const cachedReply = await getCachedResponse(compressedQuery, modelId);
// await setCachedResponse(finalQuery, modelId, reply);
```

---

### Change Filler Words (Prompt Compression)

Edit `backend/services/compress.service.js` — the `FILLER_PATTERNS` array.
Add or remove regex patterns to control what gets stripped.

---

### Change Session Duration Default

Edit `database/schema.sql` (for new users):
```sql
session_minutes INTEGER DEFAULT 60,  -- change 60 to desired minutes
```
Or change per-user in Admin Panel → Edit User → Session Duration.

---

### Change Token Quota Default

Edit `database/schema.sql`:
```sql
total_tokens    INTEGER DEFAULT 100000,  -- lifetime quota
per_query_limit INTEGER DEFAULT 2000,    -- per-request limit
```
Or change per-user in Admin Panel.

---

### Add RAG Documents (Knowledge Base)

Two ways:

**Option A — SQL (Supabase)**:
```sql
-- First get the embedding from your app, then:
INSERT INTO rag_documents (title, content, embedding)
VALUES ('My Doc Title', 'Full content here...', '[0.1, 0.2, ...]'::vector);
```

**Option B — Admin API (build a UI for this)**:
POST to `/api/admin/rag` (you'd need to add this route) which calls `rag.service.js`'s `embedText()`.

---

## 🔐 SECURITY CHECKLIST (Before Going Live)

- [ ] Changed default admin password
- [ ] JWT_SECRET is at least 32 random characters
- [ ] `.env` is in `.gitignore` and never committed
- [ ] Supabase `service_role` key is only in backend (never frontend)
- [ ] FRONTEND_URL in backend env matches exact production URL
- [ ] Rate limiting is active (already configured in `chat.routes.js`)

---

## 📊 UNDERSTANDING ANALYTICS

Analytics are logged automatically for every query in `query_analytics` table.
View them in Admin Panel → Analytics tab.

**What's tracked:**
- Which model was used
- How many tokens consumed
- Whether it was a cache hit
- Response time in milliseconds
- Anonymous vs logged-in usage

**Most Repeated Queries** come from `query_cache` table — the `hit_count` column.

---

## 🐛 TROUBLESHOOTING

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| "API key not configured" | Missing key in .env | Add key to Vercel env vars + redeploy |
| 401 on all requests | JWT_SECRET mismatch | Make sure both backend deploys use same JWT_SECRET |
| CORS error | FRONTEND_URL wrong | Set FRONTEND_URL in backend env to exact frontend URL |
| RAG returns nothing | pgvector not enabled | Run `CREATE EXTENSION IF NOT EXISTS vector;` in Supabase SQL Editor |
| Gemini summarization fails | GEMINI_API_KEY missing | Add GEMINI_API_KEY — required even if not using Gemini as chat model |
| Token bar not updating | /auth/me failing | Check backend is running and JWT is valid |
| Anonymous mode saves history | Bug in code | Verify `topicId` is not sent in anonymous requests |

---

## 🔄 VERSION CONTROL WITH GITHUB

```bash
# Initial setup
cd multi-ai-chat
git init
git add .
git commit -m "feat: initial MultiAI Chat platform"

# Create repo on GitHub, then:
git remote add origin https://github.com/yourusername/multi-ai-chat.git
git branch -M main
git push -u origin main

# Workflow for changes:
git checkout -b feature/my-feature
# make changes
git add .
git commit -m "feat: describe what you changed"
git push origin feature/my-feature
# Open Pull Request on GitHub → Merge → Vercel auto-deploys
```

**Branch strategy:**
- `main` → production (auto-deploys to Vercel)
- `develop` → staging
- `feature/*` → individual features

---

## 📱 LOCAL DEVELOPMENT

```bash
# 1. Clone
git clone https://github.com/yourusername/multi-ai-chat.git
cd multi-ai-chat

# 2. Install all dependencies
npm run install:all

# 3. Setup backend env
cp backend/.env.example backend/.env
# Fill in your Supabase URL, keys, and API keys

# 4. Setup frontend env
cp frontend/.env.example frontend/.env
# REACT_APP_API_URL=http://localhost:5000/api

# 5. Run both together
npm install          # installs concurrently
npm run dev          # starts backend (port 5000) + frontend (port 3000)
```

---

## ✅ FEATURE SUMMARY

| Feature | Where it lives |
|---------|---------------|
| Multi-model AI routing | `backend/services/ai/dispatcher.service.js` |
| Prompt compression | `backend/services/compress.service.js` |
| Topic similarity detection | `backend/services/similarity.service.js` |
| History summarization (Gemini Flash) | `backend/services/context.service.js` |
| Query caching | `backend/services/cache.service.js` |
| RAG (vector search) | `backend/services/rag.service.js` |
| Token quota management | `backend/middleware/tokenCheck.js` |
| Anonymous mode (session only) | `frontend/src/pages/AnonymousPage.jsx` |
| Admin user management | `frontend/src/pages/AdminPage.jsx` + `backend/controllers/admin.controller.js` |
| Analytics dashboard | `AdminPage.jsx` + `admin.controller.js` getAnalytics() |
| Token usage bar | `frontend/src/components/layout/TokenBar.jsx` |
| Chat history with topics | `frontend/src/components/chat/Sidebar.jsx` |
| Markdown + code highlighting | `frontend/src/components/chat/MessageBubble.jsx` |
