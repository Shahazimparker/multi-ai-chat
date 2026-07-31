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
    maxTokens: 128000,
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
    maxTokens: 128000,
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
    maxTokens: 128000,
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
    maxTokens: 128000,
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
    maxTokens: 128000,
    temperature: 0.2,
    reasoning: {
      thinking: 'enabled',
      reasoningEffort: 'max',
    },
  },

  // ── Groq / LLaMA ───────────────────────────────────────────
  // `groq-mixtral` (llama-3.1-8b-instant) and `groq-llama` (llama-3.3-70b-versatile)
  // were removed here: Groq decommissions both on 2026-08-16, after which they
  // return HTTP 400. See https://console.groq.com/docs/deprecations
  'groq-gpt-oss-20b': {
    label: 'Groq GPT-OSS 20B (Free)',
    provider: 'groq',
    apiKey: process.env.GROQ_API_KEY,
    model: 'openai/gpt-oss-20b',
    paid: false,
    maxTokens: 5999,
  },
  'groq-gpt-oss-120b': {
    label: 'Groq GPT-OSS 120B (Free)',
    provider: 'groq',
    apiKey: process.env.GROQ_API_KEY,
    model: 'openai/gpt-oss-120b',
    paid: false,
    maxTokens: 5999,
  },
  'groq-qwen3': {
    label: 'Groq Qwen3.6 27B (Free)',
    provider: 'groq',
    apiKey: process.env.GROQ_API_KEY,
    model: 'qwen/qwen3.6-27b',
    paid: false,
    maxTokens: 5999,
  },

  // ── Google Gemini ──────────────────────────────────────────
  // Gemini 2.5 Flash/Pro both shut down 2026-10-16
  // (https://ai.google.dev/gemini-api/docs/deprecations). Alias keys are kept
  // stable so stored topics and SUMMARY_MODEL below keep resolving.
  'gemini-flash': {
    label: 'Gemini Flash 3.6 (Free)',
    provider: 'gemini',
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-3.6-flash',
    paid: false,
    maxTokens: 5999,
  },
  'gemini-pro': {
    label: 'Gemini Pro 3.1 (Preview, Free)',
    provider: 'gemini',
    apiKey: process.env.GEMINI_API_KEY,
    // Google's named replacement for gemini-2.5-pro. Preview status: it can
    // change or be withdrawn on shorter notice than a stable model.
    model: 'gemini-3.1-pro-preview',
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
  'claude-sonnet-5': {
    label: 'Claude Sonnet 5 (Smart, Paid)',
    provider: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-5',
    paid: true,
    maxTokens: 200000,
  },
  'claude-opus-4-8': {
    label: 'Claude Opus 4.8 (Best, Paid)',
    provider: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-opus-4-8',
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
