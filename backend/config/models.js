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
    model:    'gemini-2.5-flash-preview-05-20',
    paid:     false,
    maxTokens: 8192,
  },
  'gemini-pro': {
    label:    'Gemini Pro 1.5 (Free)',
    provider: 'gemini',
    apiKey:   process.env.GEMINI_API_KEY,
    model:    'gemini-1.5-pro',
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
    label:    'Groq Mixtral 8x7B (Free)',
    provider: 'groq',
    apiKey:   process.env.GROQ_API_KEY,
    model:    'mixtral-8x7b-32768',
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
};

// Gemini Flash is always used for summarization (cheapest/fastest)
const SUMMARY_MODEL = MODELS['gemini-flash'];

module.exports = { MODELS, SUMMARY_MODEL };
