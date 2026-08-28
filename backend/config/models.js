// ============================================================
// FILE: backend/config/models.js
// PURPOSE: Central registry of all supported AI models
// CHANGE: Add/remove models here — frontend auto-reflects this
// ============================================================
//
// ── Reasoning capability ──────────────────────────────────────
// `reasoning` describes what a model can do, not what the user asked for. The
// request carries the choice (thinkingEnabled + reasoningEffort); this block is
// what the UI greys out against and what services/ai/reasoning.service.js
// validates a request against.
//
//   reasoning: {
//     levels:     ordered effort levels the model accepts. [] means the model
//                 thinks but exposes no dial (Claude Haiku 4.5).
//     default:    level used when thinking is on and the user picked nothing.
//     canDisable: false when the provider has no off switch — Gemini always
//                 reasons, so the UI locks the toggle on rather than lying.
//     enabledByDefault:
//                 whether the Thinking button starts on. Defaults to FALSE —
//                 reasoning tokens bill as output, so thinking is opt-in on
//                 every model that can be switched off. Only a provider with no
//                 off switch (canDisable: false) reports as on by default, and
//                 that is derived, not declared.
//     label:      what this provider calls the feature, for tooltips. Defaults
//                 to "Thinking".
//   }
//
// Omit `reasoning` entirely for a model that cannot think; the UI greys the
// Thinking button out for those. Levels are verified against provider docs —
// see the comment above each group.

const MODELS = {

  // ── DeepSeek AI ────────────────────────────────────────────
  // V4 accepts reasoning_effort "high" and "max" only; per DeepSeek's thinking
  // mode docs low/medium normalize up to high and xhigh down to max, so
  // offering those would be four names for two behaviours. Thinking is turned
  // off with thinking: {type: 'disabled'}.
  'deepseek-v4-flash': {
    label: 'DeepSeek V4 Flash',
    provider: 'deepseek',
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: 'deepseek-v4-flash',
    paid: true,
    supportsVision: true,
    maxTokens: 128000,
    reasoning: { levels: ['high', 'max'], default: 'high', canDisable: true },
  },
  'deepseek-v4-pro': {
    label: 'DeepSeek V4 Pro',
    provider: 'deepseek',
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: 'deepseek-v4-pro',
    paid: true,
    supportsVision: true,
    maxTokens: 128000,
    reasoning: { levels: ['high', 'max'], default: 'high', canDisable: true },
  },

  // ── Groq / LLaMA ───────────────────────────────────────────
  // `groq-mixtral` (llama-3.1-8b-instant) and `groq-llama` (llama-3.3-70b-versatile)
  // were removed here: Groq decommissions both on 2026-08-16, after which they
  // return HTTP 400. See https://console.groq.com/docs/deprecations
  //
  // gpt-oss and Qwen3 are reasoning models taking reasoning_effort
  // low/medium/high. Thinking is disabled by omitting the parameter rather than
  // by sending a disabled value.
  'groq-gpt-oss-20b': {
    label: 'Groq GPT-OSS 20B (Free)',
    provider: 'groq',
    apiKey: process.env.GROQ_API_KEY,
    model: 'openai/gpt-oss-20b',
    paid: false,
    maxTokens: 5999,
    reasoning: { levels: ['low', 'medium', 'high'], default: 'medium', canDisable: true },
  },
  'groq-gpt-oss-120b': {
    label: 'Groq GPT-OSS 120B (Free)',
    provider: 'groq',
    apiKey: process.env.GROQ_API_KEY,
    model: 'openai/gpt-oss-120b',
    paid: false,
    maxTokens: 5999,
    reasoning: { levels: ['low', 'medium', 'high'], default: 'medium', canDisable: true },
  },
  'groq-qwen3': {
    label: 'Groq Qwen3.6 27B (Free)',
    provider: 'groq',
    apiKey: process.env.GROQ_API_KEY,
    model: 'qwen/qwen3.6-27b',
    paid: false,
    maxTokens: 5999,
    reasoning: { levels: ['low', 'medium', 'high'], default: 'medium', canDisable: true },
  },

  // ── Google Gemini ──────────────────────────────────────────
  // Gemini 2.5 Flash/Pro both shut down 2026-10-16
  // (https://ai.google.dev/gemini-api/docs/deprecations). Alias keys are kept
  // stable so stored topics and SUMMARY_MODEL below keep resolving.
  //
  // Gemini 3 replaced thinking_budget with thinking_level and removed the off
  // switch: the floor is "minimal" (Flash) or "low" (Pro), both of which still
  // reason. canDisable is false for that reason — see
  // https://ai.google.dev/gemini-api/docs/thinking
  //
  // Free-tier status is per model id, not per family: Flash is free, Pro is
  // not. Re-check the pricing page before trusting the `paid` flag here.
  'gemini-flash': {
    label: 'Gemini Flash 3.7 (Free)',
    provider: 'gemini',
    apiKey: process.env.GEMINI_API_KEY,
    // GA (not preview) since 2026-08-13; free tier with rate limits.
    model: 'gemini-3.7-flash',
    paid: false,
    supportsVision: true,
    maxTokens: 5999,
    // 3.7 dropped "minimal", which 3.6 accepted — sending it now is an error.
    reasoning: {
      levels: ['low', 'medium', 'high'],
      default: 'medium',
      canDisable: false,
    },
  },
  'gemini-flash-lite': {
    label: 'Gemini Flash-Lite 3.5 (Free)',
    provider: 'gemini',
    apiKey: process.env.GEMINI_API_KEY,
    // Newest Flash-Lite: the Lite line stops at 3.5, there is no 3.6/3.7 Lite.
    // GA, and the most generous free-tier rate limits of the Gemini models.
    model: 'gemini-3.5-flash-lite',
    paid: false,
    supportsVision: true,
    maxTokens: 5999,
    // Defaults to minimal rather than medium — Lite is the cheap, fast tier and
    // Google tunes it for the least reasoning, not a balanced amount.
    reasoning: {
      levels: ['minimal', 'low', 'medium', 'high'],
      default: 'minimal',
      canDisable: false,
    },
  },
  'gemini-pro': {
    label: 'Gemini Pro 3.1 (Preview, Paid)',
    provider: 'gemini',
    apiKey: process.env.GEMINI_API_KEY,
    // Still "-preview"; there is no GA `gemini-3.1-pro` id. Verified against
    // Google Cloud's model page (2026-08-19), which lists model ID
    // gemini-3.1-pro-preview at launch stage Public preview.
    //
    // Paid, despite being in the same family as the free Flash models: Google's
    // pricing page shows no Free Tier row for Gemini 3.1 Pro Preview — the Pro
    // line moved behind billing, leaving Flash and Flash-Lite on the free tier.
    model: 'gemini-3.1-pro-preview',
    paid: true,
    supportsVision: true,
    maxTokens: 5999,
    reasoning: {
      levels: ['low', 'medium', 'high'],
      default: 'high',
      canDisable: false,
    },
  },

  // ── Mistral AI ────────────────────────────────────────────
  // Not reasoning models — Magistral is Mistral's reasoning line and is not
  // wired up here. No `reasoning` block, so the UI greys the Thinking button.
  // Mistral's free tier is shaped the opposite way to Gemini's and Groq's:
  // token-rich (~1B/month) but request-poor (~2 requests/minute). The scarce
  // resource is REQUESTS, not tokens, so capping context low is exactly wrong
  // here — it wastes the abundant resource without easing the scarce one.
  // 32000 lets each of those few requests carry real context. per_query_limit
  // (16000 by default) still clamps the prompt below this, so a full request
  // lands near 20K tokens; at 2 RPM that stays inside the observed ~50K TPM.
  // Groq and Gemini are left at 5999 deliberately — their free tiers meter
  // daily tokens and daily requests respectively, so bigger prompts there
  // would burn the scarce resource directly.
  'ministral-14b': {
    label: 'Ministral 14B (Vision, Free)',
    provider: 'mistral',
    apiKey: process.env.MISTRAL_API_KEY,
    model: 'ministral-14b-2512',
    paid: false,
    supportsVision: true,
    maxTokens: 128000,
  },
  'codestral-2508': {
    label: 'Codestral 2508 (Code, Free)',
    provider: 'mistral',
    apiKey: process.env.MISTRAL_API_KEY,
    model: 'codestral-2508',
    paid: false,
    maxTokens: 256000,
  },
  // Devstral 2: 123B dense agentic coding model. Deprecated by Mistral on
  // 2026-05-22 — they recommend Mistral Medium 3.5 as the replacement. Kept
  // here because the endpoint still serves it and existing topics may reference
  // it. Text-only (no vision), function-calling and structured output capable.
  'devstral-2512': {
    label: 'Devstral 2512 (Code, Deprecated)',
    provider: 'mistral',
    apiKey: process.env.MISTRAL_API_KEY,
    model: 'devstral-2512',
    paid: false,
    maxTokens: 256000,
  },
  'mistral-small': {
    label: 'Mistral Small 4 (Vision, Free)',
    provider: 'mistral',
    apiKey: process.env.MISTRAL_API_KEY,
    model: 'mistral-small-latest',
    paid: false,
    supportsVision: true,
    maxTokens: 128000,
  },
  'mistral-medium': {
    label: 'Mistral Medium (Vision, Free)',
    provider: 'mistral',
    apiKey: process.env.MISTRAL_API_KEY,
    model: 'mistral-medium-2508',
    paid: false,
    supportsVision: true,
    maxTokens: 128000,
  },
  'mistral-large': {
    label: 'Mistral Large (Vision, Free)',
    provider: 'mistral',
    apiKey: process.env.MISTRAL_API_KEY,
    model: 'mistral-large-latest',
    paid: false,
    supportsVision: true,
    maxTokens: 128000,
  },

  // ── Anthropic Claude ──────────────────────────────────────
  // Sonnet 5 and Opus 4.8 use adaptive thinking plus output_config.effort, and
  // reject budget_tokens with a 400. Haiku 4.5 predates both: Anthropic calls
  // its feature "extended thinking", it is driven by budget_tokens, and it
  // errors on effort — hence the empty levels list, which the Thinking button
  // renders as a plain on/off with no dial.

  'claude-haiku': {
    label: 'Claude Haiku (Fast, Paid)',
    provider: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-haiku-4-5-20251001',
    paid: true,
    supportsVision: true,
    maxTokens: 100000,
    reasoning: { levels: [], default: null, canDisable: true, label: 'Extended thinking' },
  },
  'claude-sonnet-5': {
    label: 'Claude Sonnet 5 (Smart, Paid)',
    provider: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-5',
    paid: true,
    supportsVision: true,
    maxTokens: 200000,
    reasoning: {
      levels: ['low', 'medium', 'high', 'xhigh', 'max'],
      default: 'high',
      canDisable: true,
    },
  },
  'claude-opus-4-8': {
    label: 'Claude Opus 4.8 (Best, Paid)',
    provider: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-opus-4-8',
    paid: true,
    supportsVision: true,
    maxTokens: 200000,
    reasoning: {
      levels: ['low', 'medium', 'high', 'xhigh', 'max'],
      default: 'high',
      canDisable: true,
    },
  },

  // ── OpenRouter (Live model list) ──────────────────────────
  // The concrete model is chosen at request time from a live list, so no static
  // reasoning capability can be declared for the entry itself.
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

// Model ids that used to exist, mapped to what replaced them. These are NOT
// aliases — a topic saved against one still fails rather than silently running
// on a different model, which would misreport what answered. The map only lets
// the error name the replacement so the user can switch in one step.
//
// The two `-reasoning` ids were duplicates that differed from their base model
// only by effort level, which is now a per-request choice.
const RETIRED_MODELS = {
  'deepseek-v4-flash-reasoning': 'deepseek-v4-flash',
  'deepseek-v4-pro-reasoning': 'deepseek-v4-pro',
  // Sonnet 4.6, superseded by Sonnet 5.
  'claude-sonnet': 'claude-sonnet-5',
  'pixtral-large': 'mistral-large',
  'codestral': 'codestral-2508',
};

module.exports = { MODELS, SUMMARY_MODEL, RETIRED_MODELS };
