# ✦ MultiAI Chat

> **8 AI models in one beautiful dark UI** — Gemini, Groq, Mistral, Cohere, GPT-4o, Claude  
> React + Node.js + Supabase · Deploy on Vercel in 30 minutes

---

## Features

| Feature | Details |
|---------|---------|
| 🤖 **8 AI Models** | Gemini Flash, Gemini Pro, Groq LLaMA, Groq Mixtral, Mistral, Cohere, GPT-4o, Claude Haiku/Sonnet/Opus |
| 👤 **Admin Panel** | Create users, set token quotas, session limits, expiry dates |
| 🧠 **Smart Context** | Last 10 messages summarized with Gemini Flash and sent as context |
| ⚡ **Query Cache** | Repeated queries served instantly from DB cache |
| 🔍 **RAG** | pgvector semantic search injects relevant docs into prompts |
| 🗜️ **Prompt Compression** | Strips filler words (please, kindly, can you…) to save tokens |
| 👻 **Anonymous Mode** | No login, session-only storage, cleared on tab close |
| 📊 **Analytics** | Model usage charts, top queries, daily trends |
| 🔐 **JWT Auth** | Secure sessions with configurable expiry per user |
| 🎨 **Colorful Dark UI** | Glassmorphism, animated orbs, syntax highlighting |

## Quick Start

See the full **[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)** for step-by-step instructions.

```bash
git clone https://github.com/YOUR_USERNAME/multi-ai-chat.git
cd multi-ai-chat/backend && npm install
cd ../frontend && npm install
# Configure .env files (see DEPLOYMENT_GUIDE.md)
# Run: backend → npm run dev | frontend → npm start
```

## Stack

- **Frontend:** React 18, React Router, Recharts, React Markdown
- **Backend:** Node.js, Express, JWT, bcrypt
- **Database:** Supabase (PostgreSQL + pgvector for RAG)
- **AI SDKs:** @google/generative-ai, groq-sdk, @anthropic-ai/sdk, openai, axios (Mistral/Cohere)
- **Hosting:** Vercel (both frontend and backend)

## Default Admin Credentials

```
Username: admin
Password: Admin@1234
```
⚠️ **Change immediately after first login.**

## License

MIT
