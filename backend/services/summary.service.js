// ============================================================
// FILE: backend/services/summary.service.js
// PURPOSE: Internal summarization using separate API keys/accounts
// ============================================================

const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Estimate tokens for a text string (same logic as tokenBudget.service.js)
 * Used here to avoid circular dependency
 */
const estimateTokens = (text = '') => {
  if (!text) return 0;
  const str = String(text).trim();
  if (!str) return 0;
  const charEstimate = Math.ceil(str.length / 4);
  const words = str.split(/\s+/).length;
  const wordEstimate = Math.ceil(words * 1.3);
  return Math.ceil((charEstimate + wordEstimate) / 2);
};

const SUMMARY_MODELS = [
  {
    provider: 'openrouter',
    model: 'microsoft/phi-3-mini-128k-instruct',
    apiKey: process.env.OPENROUTER_API_KEY,
  },
  {
    provider: 'openrouter',
    model: 'google/gemini-flash-1.5',
    apiKey: process.env.OPENROUTER_API_KEY,
  },
  {
    provider: 'gemini',
    model: 'gemini-2.5-flash-lite',
    apiKey: process.env.GEMINI_SUMMARY_API_KEY,
  },
  {
    provider: 'mistral',
    model: 'mistral-small-latest',
    apiKey: process.env.MISTRAL_SUMMARY_API_KEY,
  },
  {
    provider: 'cerebras',
    model: 'llama3.1-8b',
    apiKey: process.env.CEREBRAS_SUMMARY_API_KEY,
  },
];

const summaryPrompt = (text) => (
  `Summarize this previous conversation for chat memory.

Rules:
- CRITICAL: Preserve ALL personal information about the user — their name, job/profession, skills, preferences, location, goals, and any personal context they shared.
- Keep technical facts, model names, decisions, and unresolved questions.
- Do NOT be generic. Include specific names, technologies, numbers, and details.
- Keep it under 450 words.
- Use compact bullet points.

Conversation:
${text}`
);

/**
 * Estimate token usage for a summary call: input prompt + expected output (~600 tokens)
 */
const estimateSummaryTokens = (text) => {
  const inputTokens = estimateTokens(summaryPrompt(text));
  const outputTokens = 600; // max 450 words ≈ 585 tokens, rounded up
  return inputTokens + outputTokens;
};

const summarizeWithCerebras = async ({ model, apiKey, text }) => {
  const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: summaryPrompt(text) }],
      temperature: 0.2,
      max_tokens: 1000,
    }),
  });

  if (!res.ok) throw new Error(`Cerebras summary failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { summary: data.choices?.[0]?.message?.content?.trim(), tokensUsed: data.usage?.total_tokens || estimateSummaryTokens(text) };
};

const summarizeWithOpenRouter = async ({ model, apiKey, text }, signal = null) => {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: summaryPrompt(text) }],
      temperature: 0.2,
      max_tokens: 1000,
    }),
  });

  if (!res.ok) throw new Error(`OpenRouter summary failed: ${res.status}`);
  const data = await res.json();
  return { summary: data.choices?.[0]?.message?.content?.trim(), tokensUsed: data.usage?.total_tokens || estimateSummaryTokens(text) };
};


const summarizeWithGemini = async ({ model, apiKey, text }, signal = null) => {
  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({ model });

  const resultPromise = geminiModel.generateContent(summaryPrompt(text));

  const result = await Promise.race([
    resultPromise,
    new Promise((_, reject) => {
      if (signal?.aborted) reject({ name: 'AbortError' });
      signal?.addEventListener('abort', () => reject({ name: 'AbortError' }), { once: true });
    })
  ]);

  const summary = result.response.text().trim();
  const tokensUsed = result.response?.usageMetadata?.totalTokenCount || estimateSummaryTokens(text);
  return { summary, tokensUsed };
};

const summarizeWithMistral = async ({ model, apiKey, text }, signal = null) => {
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: summaryPrompt(text) }],
      temperature: 0.2,
      max_tokens: 1000,
      signal: signal,
    }),
  });

  if (!res.ok) throw new Error(`Mistral summary failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { summary: data.choices?.[0]?.message?.content?.trim(), tokensUsed: data.usage?.total_tokens || estimateSummaryTokens(text) };
};

const fallbackSummary = (text, signal = null) => {
  return text
    .split('\n')
    .slice(-8)
    .join('\n')
    .slice(0, 1200);
};

const summarizeMemory = async (text, signal = null) => {
  for (const cfg of SUMMARY_MODELS) {
    if (!cfg.apiKey) continue;

    try {
      let result;

      if (cfg.provider === 'openrouter') {
        result = await summarizeWithOpenRouter({ ...cfg, text }, signal);
      } else if (cfg.provider === 'cerebras') {
        result = await summarizeWithCerebras({ ...cfg, text }, signal);
      } else if (cfg.provider === 'gemini') {
        result = await summarizeWithGemini({ ...cfg, text }, signal);
      } else if (cfg.provider === 'mistral') {
        result = await summarizeWithMistral({ ...cfg, text }, signal);
      }

      if (result?.summary) {
        console.log(`[Summary] Used ${cfg.provider}/${cfg.model} (tokens: ${result.tokensUsed})`);
        return {
          summary: result.summary,
          provider: cfg.provider,
          model: cfg.model,
          fallback: false,
          tokensUsed: result.tokensUsed || estimateSummaryTokens(text),
        };
      }
    } catch (err) {
      console.error(`[Summary] ${cfg.provider}/${cfg.model} failed:`, err.message);
      if (err.name === 'AbortError') throw err; // Propagate abort
    }
  }

  return {
    summary: fallbackSummary(text, signal),
    provider: 'local',
    model: 'truncate',
    fallback: true,
    tokensUsed: 0,  // truncation costs nothing
  };
};

module.exports = { summarizeMemory };