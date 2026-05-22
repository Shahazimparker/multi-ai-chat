// ============================================================
// FILE: backend/config/models.js
// PURPOSE: Central registry of all supported AI models
// CHANGE: Add/remove models here — frontend auto-reflects this
// ============================================================

const MODELS = {

  // ── DeepSeek AI ────────────────────────────────────────────
  'deepseek-v4-flash': {
    label: 'DeepSeek V4 Flash — Fast (Paid)',
    provider: 'deepseek',
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: 'deepseek-v4-flash',
    paid: true,
    maxTokens: 64000,
    reasoning: {
      thinking: 'enabled',
      reasoningEffort: 'high',
    },
  },
  'deepseek-v4-flash-reasoning': {
    label: 'DeepSeek V4 Flash — Reasoning (Paid)',
    provider: 'deepseek',
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: 'deepseek-v4-flash',
    paid: true,
    maxTokens: 64000,
    reasoning: {
      thinking: 'enabled',
      reasoningEffort: 'max',
    },
  },
  'deepseek-v4-pro': {
    label: 'DeepSeek V4 Pro — Fast (Paid)',
    provider: 'deepseek',
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: 'deepseek-v4-pro',
    paid: true,
    maxTokens: 64000,
    reasoning: {
      thinking: 'enabled',
      reasoningEffort: 'high',
    },
  },
  'deepseek-v4-pro-reasoning': {
    label: 'DeepSeek V4 Pro — Reasoning (Paid)',
    provider: 'deepseek',
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: 'deepseek-v4-pro',
    paid: true,
    maxTokens: 64000,
    reasoning: {
      thinking: 'enabled',
      reasoningEffort: 'max',
    },
  },
  'deepseek-v4-pro-erp': {
    label: 'DeepSeek V4 Pro — ERP (Paid)',
    provider: 'deepseek',
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: 'deepseek-v4-pro',
    paid: true,
    maxTokens: 64000,
    temperature: 0.2,
    reasoning: {
      thinking: 'enabled',
      reasoningEffort: 'max',
    },
  },

  // ── Groq / LLaMA ───────────────────────────────────────────
  'groq-mixtral': {
    label: 'Groq LLaMA 3.1 8B Instant (Free)',
    provider: 'groq',
    apiKey: process.env.GROQ_API_KEY,
    model: 'llama-3.1-8b-instant',
    paid: false,
    maxTokens: 5999,
  },
  'groq-llama': {
    label: 'Groq LLaMA 3.3 70B (Free)',
    provider: 'groq',
    apiKey: process.env.GROQ_API_KEY,
    model: 'llama-3.3-70b-versatile',
    paid: false,
    maxTokens: 5999,
  },

  // ── Google Gemini ──────────────────────────────────────────
  'gemini-flash': {
    label: 'Gemini Flash 2.5 (Free)',
    provider: 'gemini',
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.5-flash',
    paid: false,
    maxTokens: 5999,
  },
  'gemini-pro': {
    label: 'Gemini Pro 2.5 (Free)',
    provider: 'gemini',
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.5-pro',
    paid: false,
    maxTokens: 5999,
  },

  // ── Mistral AI ────────────────────────────────────────────
  'mistral-small': {
    label: 'Mistral Small (Free)',
    provider: 'mistral',
    apiKey: process.env.MISTRAL_API_KEY,
    model: 'mistral-small-latest',
    paid: false,
    maxTokens: 5999,
  },
  'mistral-medium': {
    label: 'Mistral Medium (Free)',
    provider: 'mistral',
    apiKey: process.env.MISTRAL_API_KEY,
    model: 'mistral-medium-latest',
    paid: false,
    maxTokens: 5999,
  },

  // ── Anthropic Claude ──────────────────────────────────────
  'claude-haiku': {
    label: 'Claude Haiku (Fast, Paid)',
    provider: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-haiku-4-5-20251001',
    paid: true,
    maxTokens: 100000,
  },
  'claude-sonnet': {
    label: 'Claude Sonnet (Smart, Paid)',
    provider: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-6',
    paid: true,
    maxTokens: 200000,
  },
  'claude-opus': {
    label: 'Claude Opus (Best, Paid)',
    provider: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-opus-4-6',
    paid: true,
    maxTokens: 200000,
  },

  // ── OpenRouter (Live model list) ──────────────────────────
  'openrouter': {
    label: 'OpenRouter',
    provider: 'openrouter',
    apiKey: process.env.OPENROUTER_API_KEY,
    model: 'openrouter',
    paid: true,
    unified: true,
    maxTokens: 128000,
    models: [],
  },
};

// Gemini Flash is always used for summarization (cheapest/fastest)
const SUMMARY_MODEL = MODELS['gemini-flash'];

module.exports = { MODELS, SUMMARY_MODEL };
