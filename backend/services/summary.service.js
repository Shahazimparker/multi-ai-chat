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

const summaryPrompt = (text, strict = false) => (
  `Summarize this previous conversation for chat memory.

Rules:
- CRITICAL: Preserve ALL personal information about the user — their name, job/profession, skills, preferences, location, goals, and any personal context they shared.
- Keep technical facts, model names, decisions, and unresolved questions.
- Do NOT be generic. Include specific names, technologies, numbers, and details.
- Keep it under 450 words.
- Use compact bullet points.
${strict ? '- VALIDATION RETRY: explicitly preserve important names, acronyms, unresolved questions, and repeated technical/business keywords from the source.\n- Include at least 3 concrete entities or keywords that appear in the source when available.' : ''}

Conversation:
${text}`
);

/**
 * Estimate token usage for a summary call: input prompt + expected output (~600 tokens)
 */
const estimateSummaryTokens = (text, strict = false) => {
  const inputTokens = estimateTokens(summaryPrompt(text, strict));
  const outputTokens = 600; // max 450 words ≈ 585 tokens, rounded up
  return inputTokens + outputTokens;
};

const getImportantTerms = (text = '') => {
  const matches = String(text).match(/\b([A-Z][a-zA-Z0-9_-]{2,}|[A-Z]{2,}|\d[\d.,%-]*|[a-z][a-z0-9_-]{4,})\b/g) || [];
  const stopwords = new Set(['there', 'their', 'about', 'would', 'could', 'should', 'after', 'before', 'where', 'which', 'while', 'using', 'please', 'thanks', 'summary', 'conversation']);
  const counts = new Map();
  for (const rawTerm of matches) {
    const term = rawTerm.trim();
    const normalized = term.toLowerCase();
    if (stopwords.has(normalized)) continue;
    counts.set(term, (counts.get(term) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 10)
    .map(([term]) => term);
};

const hasUnresolvedQuestion = (text = '') => (
  /\?|\bunresolved\b|\bpending\b|\bblocked\b|\bneed(s)?\b|\bnext step(s)?\b/i.test(text)
);

const isSummaryQualityAcceptable = (sourceText, summaryText) => {
  const summary = String(summaryText || '').trim();
  if (!summary) return false;

  const sourceTerms = getImportantTerms(sourceText);
  if (sourceTerms.length === 0) return summary.length >= 120;

  const lowerSummary = summary.toLowerCase();
  const overlapCount = sourceTerms.filter(term => lowerSummary.includes(term.toLowerCase())).length;
  const requiresQuestionCarry = hasUnresolvedQuestion(sourceText);
  const keepsQuestionSignal = !requiresQuestionCarry || hasUnresolvedQuestion(summary);

  return overlapCount >= Math.min(3, sourceTerms.length) && keepsQuestionSignal;
};

const summarizeWithCerebras = async ({ model, apiKey, text, strict = false }) => {
  const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: summaryPrompt(text, strict) }],
      temperature: 0.2,
      max_tokens: 1000,
    }),
  });

  if (!res.ok) throw new Error(`Cerebras summary failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { summary: data.choices?.[0]?.message?.content?.trim(), tokensUsed: data.usage?.total_tokens || estimateSummaryTokens(text, strict) };
};

const summarizeWithOpenRouter = async ({ model, apiKey, text, strict = false }, signal = null) => {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: summaryPrompt(text, strict) }],
      temperature: 0.2,
      max_tokens: 1000,
    }),
  });

  if (!res.ok) throw new Error(`OpenRouter summary failed: ${res.status}`);
  const data = await res.json();
  return { summary: data.choices?.[0]?.message?.content?.trim(), tokensUsed: data.usage?.total_tokens || estimateSummaryTokens(text, strict) };
};


const summarizeWithGemini = async ({ model, apiKey, text, strict = false }, signal = null) => {
  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({ model });

  const resultPromise = geminiModel.generateContent(summaryPrompt(text, strict));

  const result = await Promise.race([
    resultPromise,
    new Promise((_, reject) => {
      if (signal?.aborted) reject({ name: 'AbortError' });
      signal?.addEventListener('abort', () => reject({ name: 'AbortError' }), { once: true });
    })
  ]);

  const summary = result.response.text().trim();
  const tokensUsed = result.response?.usageMetadata?.totalTokenCount || estimateSummaryTokens(text, strict);
  return { summary, tokensUsed };
};

const summarizeWithMistral = async ({ model, apiKey, text, strict = false }, signal = null) => {
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: summaryPrompt(text, strict) }],
      temperature: 0.2,
      max_tokens: 1000,
    }),
  });

  if (!res.ok) throw new Error(`Mistral summary failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { summary: data.choices?.[0]?.message?.content?.trim(), tokensUsed: data.usage?.total_tokens || estimateSummaryTokens(text, strict) };
};

const fallbackSummary = (text) => {
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
      for (const strict of [false, true]) {
        let result;

        if (cfg.provider === 'openrouter') {
          result = await summarizeWithOpenRouter({ ...cfg, text, strict }, signal);
        } else if (cfg.provider === 'cerebras') {
          result = await summarizeWithCerebras({ ...cfg, text, strict }, signal);
        } else if (cfg.provider === 'gemini') {
          result = await summarizeWithGemini({ ...cfg, text, strict }, signal);
        } else if (cfg.provider === 'mistral') {
          result = await summarizeWithMistral({ ...cfg, text, strict }, signal);
        }

        if (result?.summary && isSummaryQualityAcceptable(text, result.summary)) {
          console.log(`[Summary] Used ${cfg.provider}/${cfg.model}${strict ? ' (strict retry)' : ''} (tokens: ${result.tokensUsed})`);
          return {
            summary: result.summary,
            provider: cfg.provider,
            model: cfg.model,
            fallback: false,
            tokensUsed: result.tokensUsed || estimateSummaryTokens(text, strict),
          };
        }

        if (result?.summary && !strict) {
          console.warn(`[Summary] Quality check failed for ${cfg.provider}/${cfg.model}; retrying with stricter prompt`);
        }
      }
    } catch (err) {
      console.error(`[Summary] ${cfg.provider}/${cfg.model} failed:`, err.message);
      if (err.name === 'AbortError') throw err; // Propagate abort
    }
  }

  return {
    summary: fallbackSummary(text),
    provider: 'local',
    model: 'truncate',
    fallback: true,
    tokensUsed: 0,  // truncation costs nothing
  };
};

module.exports = { summarizeMemory };
