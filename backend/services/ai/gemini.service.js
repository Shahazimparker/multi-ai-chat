// ============================================================
// FILE: backend/services/ai/gemini.service.js
// PURPOSE: Calls Google Gemini API
// CHANGE: Model names in config/models.js
// ============================================================

const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Shared helper to build Gemini model params from messages.
 */
function buildGeminiModel(genAI, modelName, messages) {
  const systemMessages = messages.filter(m => m.role === 'system');
  const systemInstruction = systemMessages.length > 0
    ? systemMessages.map(m => m.content).join('\n')
    : undefined;

  const modelParams = { model: modelName };
  if (systemInstruction) {
    modelParams.systemInstruction = {
      role: 'system',
      parts: [{ text: systemInstruction }],
    };
  }
  return genAI.getGenerativeModel(modelParams);
}

/** Converts message content (string, or OpenAI-style parts array) to Gemini parts. */
function toParts(content) {
  if (typeof content === 'string') return content ? [{ text: content }] : [];
  if (!Array.isArray(content)) return content == null ? [] : [{ text: String(content) }];

  const parts = [];
  for (const part of content) {
    if (typeof part === 'string') {
      if (part) parts.push({ text: part });
      continue;
    }
    if (part?.text) {
      parts.push({ text: part.text });
      continue;
    }
    const url = typeof part?.image_url === 'string' ? part.image_url : part?.image_url?.url;
    const dataUrl = typeof url === 'string' ? url.match(/^data:([^;,]+);base64,(.+)$/) : null;
    if (dataUrl) parts.push({ inlineData: { mimeType: dataUrl[1], data: dataUrl[2] } });
  }
  return parts;
}

/**
 * Builds Gemini chat contents from our provider-neutral message array.
 *
 * Unlike Claude/OpenAI, Gemini rejects a history that starts with a model turn
 * ("First content should be with role 'user', got model") and requires strict
 * user/model alternation. Our pipeline can produce both: the conversation
 * summary is injected as an assistant turn, and history trimming can drop the
 * leading user turn. Normalize here so every caller is safe.
 */
function buildGeminiHistory(messages) {
  const mapped = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
      parts: toParts(m.content),
    }))
    .filter(m => m.parts.length > 0);

  // History must open with a user turn.
  while (mapped.length > 0 && mapped[0].role === 'model') mapped.shift();

  // Merge consecutive same-role turns — Gemini enforces alternation.
  const history = [];
  for (const item of mapped) {
    const previous = history[history.length - 1];
    if (previous && previous.role === item.role) {
      previous.parts.push(...item.parts);
    } else {
      history.push(item);
    }
  }
  return history;
}

/**
 * Splits messages into the startChat history plus the outgoing message parts.
 * Trailing user turns are folded into the outgoing message so the conversation
 * stays strictly alternating.
 */
function buildGeminiRequest(messages) {
  const history = buildGeminiHistory(messages);
  const outgoing = [];

  while (history.length > 0 && history[history.length - 1].role === 'user') {
    outgoing.unshift(...history.pop().parts);
  }

  return { history, message: outgoing.length > 0 ? outgoing : [{ text: ' ' }] };
}

/**
 * Non-streaming call — sends messages to Gemini API
 * @param {string} modelName  Gemini model identifier
 * @param {string} apiKey     Gemini API key
 * @param {Array}  messages   [{role: 'user'|'model', content: string}]
 * @param {AbortSignal} signal  optional signal for cancellation
 * @returns {Object}          {text, tokensUsed}
 */
const callGemini = async (modelName, apiKey, messages, signal = null) => {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = buildGeminiModel(genAI, modelName, messages);

  const { history, message } = buildGeminiRequest(messages);

  const chat = model.startChat({ history });
  const resultPromise = chat.sendMessage(message);

  // Google SDK doesn't natively support AbortSignal yet, so we race it
  const result = await Promise.race([
    resultPromise,
    new Promise((_, reject) => {
      if (signal?.aborted) reject({ name: 'AbortError' });
      signal?.addEventListener('abort', () => reject({ name: 'AbortError' }), { once: true });
    })
  ]);

  const text = result.response.text();
  const tokensUsed = result.response.usageMetadata?.totalTokenCount || 0;

  return { text, tokensUsed };
};

/**
 * Streaming variant for Gemini — yields text deltas via onChunk callback.
 * @param {string} modelName
 * @param {string} apiKey
 * @param {Array} messages
 * @param {AbortSignal|null} signal
 * @param {(text: string) => void} onChunk
 * @returns {Promise<{text: string, tokensUsed: number}>}
 */
const callGeminiStream = async (modelName, apiKey, messages, signal = null, onChunk) => {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = buildGeminiModel(genAI, modelName, messages);

  const { history, message } = buildGeminiRequest(messages);

  const chat = model.startChat({ history });

  // Use sendMessageStream instead of sendMessage
  const resultPromise = chat.sendMessageStream(message);

  const result = await Promise.race([
    resultPromise,
    new Promise((_, reject) => {
      if (signal?.aborted) reject({ name: 'AbortError' });
      signal?.addEventListener('abort', () => reject({ name: 'AbortError' }), { once: true });
    })
  ]);

  let fullText = '';
  let tokensUsed = 0;

  for await (const item of result.stream) {
    const delta = item.text();
    if (delta) {
      fullText += delta;
      if (onChunk) onChunk(delta);
    }
  }

  // Get token usage from the aggregated response
  const response = await result.response;
  tokensUsed = response.usageMetadata?.totalTokenCount || 0;

  return { text: fullText, tokensUsed };
};

module.exports = { callGemini, callGeminiStream, buildGeminiHistory, buildGeminiRequest };
