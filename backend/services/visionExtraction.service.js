// ============================================================
// FILE: backend/services/visionExtraction.service.js
// PURPOSE: Turn an image into searchable text, via an ordered provider chain.
//
//   Shared by both ingest paths — chat file upload and knowledge-base
//   collections — which previously diverged: only one passed a vision callback
//   at all, and the model it named had already been retired.
//
//   FIXED PRIORITY. The chain runs DeepSeek first (strongest transcription at
//   the lowest paid cost), then the free-tier Mistral key, then the OpenRouter
//   vision models. The order is deliberate and not quota-driven — see
//   visionChain() below.
//
//   THE BURST PROBLEM. Ingest is bursty: a 40-image document fires 40 calls
//   back to back. Once a provider throttles, a naive chain would retry it for
//   every remaining image — paying a 429 round-trip each time AND the next
//   model afterwards. So a rate-limited provider is put on a cooldown and
//   skipped for the rest of the run.
//
//   Extraction quality matters more here than in most places: whatever this
//   returns is embedded and can later be cited to the user as a verified
//   source. A wrong transcription is not a silent failure, it is a confident
//   one — which is why an unreadable image must yield nothing rather than a
//   placeholder string.
// ============================================================

const dispatcher = require('./ai/dispatcher.service');

const EXTRACTION_PROMPT = [
  'Transcribe this image completely and accurately.',
  '',
  '- Reproduce all visible text verbatim, including code, identifiers, error codes and version numbers.',
  '- Preserve table structure and reading order.',
  '- For a chart or diagram, state what it shows and give the concrete values or labels it carries.',
  '- Do not summarise, interpret beyond what is shown, or add commentary.',
  '- If the image contains no legible content, reply with exactly: NO_LEGIBLE_CONTENT',
].join('\n');

/** Marker the prompt asks for when an image carries nothing readable. */
const NO_CONTENT = 'NO_LEGIBLE_CONTENT';

// How long a rate-limited provider is skipped. Long enough to cover the rest of
// a bulk ingest, short enough that the next upload retries the free tier.
const COOLDOWN_MS = Number(process.env.VISION_COOLDOWN_MS || 120000);

// providerKey -> epoch ms until which it is skipped. Module-level so it is
// shared across every image in a run.
const cooldowns = new Map();

/**
 * The ordered chain: DeepSeek, Mistral, then OpenRouter.
 *
 * DeepSeek leads as the best quality/cost trade-off for dense text and tables.
 * MISTRAL_SUMMARY_API_KEY is preferred over MISTRAL_API_KEY so bulk ingest
 * does not compete with user-facing chat for the same quota. The two
 * OpenRouter vision models close the chain as further fallbacks.
 */
const visionChain = () => {
  const ordered = [
    {
      provider: 'deepseek',
      model: process.env.VISION_DEEPSEEK_MODEL || 'deepseek-v4-flash',
      apiKey: process.env.DEEPSEEK_API_KEY,
      tier: 'paid',
    },
    {
      provider: 'mistral',
      model: process.env.VISION_FREE_MODEL || 'mistral-small-latest',
      apiKey: process.env.MISTRAL_SUMMARY_API_KEY || process.env.MISTRAL_API_KEY,
      tier: 'free',
    },
    {
      provider: 'openrouter',
      model: process.env.VISION_MODEL || 'google/gemini-2.5-flash-lite',
      apiKey: process.env.OPENROUTER_API_KEY,
      tier: 'paid',
    },
    {
      provider: 'openrouter',
      model: 'google/gemini-3.1-flash-lite',
      apiKey: process.env.OPENROUTER_API_KEY,
      tier: 'paid',
    },
  ];

  const seen = new Set();
  return ordered.filter((c) => {
    if (!c.apiKey) return false;
    const key = `${c.provider}:${c.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const providerKey = (cfg) => `${cfg.provider}:${cfg.model}`;

const isCoolingDown = (cfg) => {
  const until = cooldowns.get(providerKey(cfg));
  if (!until) return false;
  if (Date.now() >= until) {
    cooldowns.delete(providerKey(cfg));
    return false;
  }
  return true;
};

const startCooldown = (cfg) => {
  cooldowns.set(providerKey(cfg), Date.now() + COOLDOWN_MS);
  console.warn(`[Vision] "${providerKey(cfg)}" rate limited; skipping it for ${Math.round(COOLDOWN_MS / 1000)}s.`);
};

const clearCooldowns = () => cooldowns.clear();

const isRateLimited = (err) => {
  const status = err?.response?.status || err?.status;
  if (status === 429) return true;
  return /\b429\b|rate.?limit|quota|too many requests/i.test(String(err?.message || ''));
};

/**
 * OpenAI-style multimodal message, which both OpenRouter and Mistral accept.
 */
const buildMessages = (base64Image, mimeType) => ([
  {
    role: 'user',
    content: [
      { type: 'text', text: EXTRACTION_PROMPT },
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
    ],
  },
]);

/**
 * Local OCR, used only when every API provider is unavailable. Slower and
 * weaker than a vision model, but it needs no network and no quota — the
 * difference between a degraded index entry and none at all.
 *
 * tesseract.js is required lazily: it pulls in a large worker bundle that most
 * requests never need.
 */
const runLocalOcr = async (buffer) => {
  try {
    const { createWorker } = require('tesseract.js');
    // cachePath defaults to '.', the deployment directory, which is read-only on
    // serverless hosts. The write failure is swallowed by tesseract, so nothing
    // breaks — it just means eng.traineddata is re-fetched from the jsdelivr CDN
    // on every cold start. That is a network dependency on the one path that
    // exists for when the network providers are already unavailable. /tmp is
    // writable, so the cache survives at least within a warm container.
    const worker = await createWorker('eng', undefined, {
      cachePath: process.env.OCR_CACHE_DIR || require('os').tmpdir(),
    });
    try {
      const { data } = await worker.recognize(buffer);
      const text = String(data?.text || '').trim();
      if (text) console.log(`[Vision] Local OCR extracted ${text.length} chars.`);
      return text || null;
    } finally {
      await worker.terminate();
    }
  } catch (err) {
    console.warn('[Vision] Local OCR failed:', err.message);
    return null;
  }
};

/**
 * extractTextFromImage — run an image through the chain and return its text.
 *
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {{ signal?: AbortSignal, allowLocalOcr?: boolean }} options
 * @returns {Promise<{ text: string|null, provider: string|null, tokensUsed: number }>}
 *          `text` is null when the image genuinely carries nothing readable, or
 *          when every provider failed. Callers must NOT store a placeholder in
 *          its place — see the note at the top of this file.
 */
const extractTextFromImage = async (buffer, mimeType, options = {}) => {
  const { signal = null, allowLocalOcr = true } = options;

  if (!buffer || !buffer.length) {
    return { text: null, provider: null, tokensUsed: 0 };
  }

  const base64Image = buffer.toString('base64');
  const messages = buildMessages(base64Image, mimeType || 'image/png');
  const chain = visionChain();

  let tokensUsed = 0;

  for (const cfg of chain) {
    if (isCoolingDown(cfg)) continue;

    try {
      // disableTools: the OpenRouter path attaches this app's generate_ppt
      // schema to every call with tool_choice 'auto'. Transcribing a slide
      // image, the model can answer with a tool call instead of text, leaving
      // `text` empty — a paid round-trip that reads here as a failed provider.
      const result = await dispatcher.dispatchToAI(cfg, messages, signal, { disableTools: true });
      tokensUsed += result?.tokensUsed || 0;

      const text = String(result?.text || '').trim();
      if (!text) throw new Error('empty response');

      // Exact match, not `includes`. A transcription can legitimately CONTAIN
      // this token — a screenshot of these very sources, or of a log line — and
      // substring matching would throw that good extraction away.
      if (text.toUpperCase() === NO_CONTENT) {
        console.log(`[Vision] "${providerKey(cfg)}" reports no legible content.`);
        return { text: null, provider: providerKey(cfg), tokensUsed };
      }

      console.log(`[Vision] Extracted ${text.length} chars via ${providerKey(cfg)} (${cfg.tier}).`);
      return { text, provider: providerKey(cfg), tokensUsed };
    } catch (err) {
      if (err?.name === 'AbortError' || err?.name === 'CanceledError') throw err;

      if (isRateLimited(err)) {
        // Skip this provider for the remainder of the burst rather than paying
        // a 429 round-trip on every image still to come.
        startCooldown(cfg);
      } else {
        console.warn(`[Vision] "${providerKey(cfg)}" failed: ${err.message}`);
      }
    }
  }

  if (allowLocalOcr) {
    console.warn('[Vision] All API providers unavailable; falling back to local OCR.');
    const text = await runLocalOcr(buffer);
    if (text) return { text, provider: 'tesseract-local', tokensUsed };
  }

  console.error('[Vision] Could not extract any text from image.');
  return { text: null, provider: null, tokensUsed };
};

/**
 * The callback shape documentLoader's ImageLoader expects.
 * Returns null rather than a placeholder so the loader can treat an unreadable
 * image as absent content instead of indexing an apology.
 */
const createVisionCallback = (options = {}) => async (base64Image, mimeType) => {
  const buffer = Buffer.from(base64Image, 'base64');
  const { text } = await extractTextFromImage(buffer, mimeType, options);
  return text;
};

module.exports = {
  extractTextFromImage,
  createVisionCallback,
  visionChain,
  clearCooldowns,
  isRateLimited,
  EXTRACTION_PROMPT,
  NO_CONTENT,
};
