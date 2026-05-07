// ============================================================
// FILE: backend/config/models.js
// PURPOSE: Central registry of all supported AI models
// CHANGE: Add/remove models here — frontend auto-reflects this
// ============================================================

const MODELS = {
  // ── Google Gemini ──────────────────────────────────────────
  'gemini-flash':  {
    label:    'Gemini Flash 2.5 (Free)',
    provider: 'gemini',
    apiKey:   process.env.GEMINI_API_KEY,
    model:    'gemini-2.5-flash',
    paid:     false,
    maxTokens: 8192,
  },
  'gemini-pro': {
    label:    'Gemini Pro 2.5 (Free)',
    provider: 'gemini',
    apiKey:   process.env.GEMINI_API_KEY,
    model:    'gemini-2.5-pro',
    paid:     false,
    maxTokens: 8192,
  },

  // ── Groq (Ultra-fast inference) ───────────────────────────
  'groq-llama': {
    label:    'Groq LLaMA 3.3 70B (Free)',
    provider: 'groq',
    apiKey:   process.env.GROQ_API_KEY,
    model:    'llama-3.3-70b-versatile',
    paid:     false,
    maxTokens: 8192,
  },
  'groq-mixtral': {
    label:    'Groq LLaMA 3.1 8B Instant (Free)',
    provider: 'groq',
    apiKey:   process.env.GROQ_API_KEY,
    model:    'llama-3.1-8b-instant',
    paid:     false,
    maxTokens: 8192,
  },

  // ── Mistral AI ────────────────────────────────────────────
  'mistral-small': {
    label:    'Mistral Small (Free)',
    provider: 'mistral',
    apiKey:   process.env.MISTRAL_API_KEY,
    model:    'mistral-small-latest',
    paid:     false,
    maxTokens: 4096,
  },
  'mistral-medium': {
    label:    'Mistral Medium (Free)',
    provider: 'mistral',
    apiKey:   process.env.MISTRAL_API_KEY,
    model:    'mistral-medium-latest',
    paid:     false,
    maxTokens: 8192,
  },

  // ── Cohere ────────────────────────────────────────────────
  'cohere-command': {
    label:    'Cohere Command R (Free)',
    provider: 'cohere',
    apiKey:   process.env.COHERE_API_KEY,
    model:    'command-r',
    paid:     false,
    maxTokens: 4096,
  },
  'cohere-command-plus': {
    label:    'Cohere Command R+ (Free)',
    provider: 'cohere',
    apiKey:   process.env.COHERE_API_KEY,
    model:    'command-r-plus',
    paid:     false,
    maxTokens: 4096,
  },

  // ── OpenAI GPT ────────────────────────────────────────────
  'gpt-4o-mini': {
    label:    'GPT-4o Mini (Paid)',
    provider: 'openai',
    apiKey:   process.env.OPENAI_API_KEY,
    model:    'gpt-4o-mini',
    paid:     true,
    maxTokens: 4096,
  },
  'gpt-4o': {
    label:    'GPT-4o (Paid)',
    provider: 'openai',
    apiKey:   process.env.OPENAI_API_KEY,
    model:    'gpt-4o',
    paid:     true,
    maxTokens: 4096,
  },

  // ── Anthropic Claude ──────────────────────────────────────
  'claude-haiku': {
    label:    'Claude Haiku (Fast, Paid)',
    provider: 'claude',
    apiKey:   process.env.ANTHROPIC_API_KEY,
    model:    'claude-haiku-4-5-20251001',
    paid:     true,
    maxTokens: 4096,
  },
  'claude-sonnet': {
    label:    'Claude Sonnet (Smart, Paid)',
    provider: 'claude',
    apiKey:   process.env.ANTHROPIC_API_KEY,
    model:    'claude-sonnet-4-6',
    paid:     true,
    maxTokens: 4096,
  },
  'claude-opus': {
    label:    'Claude Opus (Best, Paid)',
    provider: 'claude',
    apiKey:   process.env.ANTHROPIC_API_KEY,
    model:    'claude-opus-4-6',
    paid:     true,
    maxTokens: 4096,
  },
  'openrouter': {
  label: 'OpenRouter',
  provider: 'openrouter',
  apiKey: process.env.OPENROUTER_API_KEY,
  model: 'meta-llama/llama-3.1-8b-instruct:free',
  paid: false,
  unified: true,
  models: [
    { id: 'meta-llama/llama-3.1-8b-instruct:free', label: 'Llama 3.1 8B Instruct (Free)', paid: false },
    { id: 'google/gemini-flash-1.5', label: 'Gemini Flash 1.5', paid: false },
    { id: 'mistralai/mistral-7b-instruct:free', label: 'Mistral 7B Instruct (Free)', paid: false },
  ],
},

'together': {
  label: 'Together AI',
  provider: 'together',
  apiKey: process.env.TOGETHER_API_KEY,
  model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
  paid: false,
  unified: true,
  models: [
    { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', label: 'Llama 3.1 8B Turbo', paid: false },
    { id: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', label: 'Llama 3.1 70B Turbo', paid: true },
  ],
},

'anyapi': {
  label: 'AnyAPI',
  provider: 'anyapi',
  apiKey: process.env.ANYAPI_API_KEY,
  model: 'gpt-4o-mini',
  paid: true,
  unified: true,
  models: [
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini', paid: true },
    { id: 'gpt-4o', label: 'GPT-4o', paid: true },
    { id: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet', paid: true },
  ],
},
};

// Gemini Flash is always used for summarization (cheapest/fastest)
const SUMMARY_MODEL = MODELS['gemini-flash'];

module.exports = { MODELS, SUMMARY_MODEL };
