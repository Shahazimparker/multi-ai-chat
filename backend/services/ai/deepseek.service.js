// ============================================================
// FILE: backend/services/ai/deepseek.service.js
// PURPOSE: Calls Deepseek flash
// ============================================================

const axios = require('axios');
const { resolveReasoning } = require('./reasoning.service');
const { extractCacheUsage } = require('./promptCache.service');


const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

/**
 * Checks if messages contain multimodal image content.
 */
function hasImageContent(messages) {
  if (!Array.isArray(messages)) return false;
  return messages.some((m) => {
    if (Array.isArray(m?.content)) {
      return m.content.some((part) => part?.type === 'image_url' || part?.image_url);
    }
    return false;
  });
}

/**
 * Resolves the DeepSeek model name, auto-switching to the vision endpoint if image content is present.
 */
function resolveDeepseekModel(model, messages) {
  if (hasImageContent(messages)) {
    if (typeof model === 'string' && model.includes('vision')) return model;
    return process.env.DEEPSEEK_VISION_MODEL || 'deepseek-v4-flash-vision-exp';
  }
  return model;
}

/**
 * Extracts human-readable error descriptions from Axios errors (especially stream errors).
 */
async function formatAxiosError(err, defaultLabel = 'DeepSeek') {
  if (err?.response) {
    let detail = '';
    const data = err.response.data;
    if (data) {
      if (typeof data.on === 'function') {
        try {
          const raw = await new Promise((resolve) => {
            let buf = '';
            data.on('data', (c) => { buf += c.toString(); });
            data.on('end', () => resolve(buf));
            data.on('error', () => resolve(''));
          });
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              detail = parsed?.error?.message || parsed?.message || raw;
            } catch {
              detail = raw;
            }
          }
        } catch { /* skip */ }
      } else if (typeof data === 'object') {
        detail = data?.error?.message || data?.message || JSON.stringify(data);
      } else if (typeof data === 'string') {
        detail = data;
      }
    }
    const msg = detail
      ? `${defaultLabel} error (${err.response.status}): ${detail}`
      : `${defaultLabel} error (${err.response.status}): ${err.message}`;
    const newErr = new Error(msg, { cause: err });
    newErr.status = err.response.status;
    newErr.response = err.response;
    return newErr;
  }
  return err;
}

/**
 * Shared helper to build Deepseek request body.
 */
function buildDeepseekBody(model, messages, modelConfig, reasoningRequest) {
  const targetModel = resolveDeepseekModel(model, messages);
  const body = {
    model: targetModel,
    messages,
    max_tokens: 16000,
    temperature: modelConfig?.temperature ?? 0.7,
  };

  // V4 wants both fields together: `thinking` switches the mode, and
  // `reasoning_effort` grades it. Sending effort without the mode is ignored.
  const decision = resolveReasoning(modelConfig, reasoningRequest);
  if (decision.supported) {
    body.thinking = { type: decision.enabled ? 'enabled' : 'disabled' };
    if (decision.enabled && decision.effort) {
      body.reasoning_effort = decision.effort;
    }
  }
  return body;
}

const calldeepseekAPI = async (model, apiKey, messages, signal = null, modelConfig = null, reasoningRequest = {}) => {
  const body = buildDeepseekBody(model, messages, modelConfig, reasoningRequest);
  let response;
  try {
    response = await axios.post(DEEPSEEK_URL, body, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal,
    });
  } catch (err) {
    throw await formatAxiosError(err, 'DeepSeek');
  }

  const message = response.data.choices[0].message;
  return {
    text: message.content,
    // Thinking mode returns the chain of thought beside the answer, not inside
    // it. Without this the reasoning tokens are billed and then discarded.
    reasoning: message.reasoning_content || message.reasoning || '',
    tokensUsed: response.data.usage?.total_tokens || 0,
    // DeepSeek caches context automatically and reports the split in
    // prompt_cache_hit_tokens. Hits bill at a tenth of the uncached rate, so
    // leaving this unread hid the single largest saving available here.
    ...extractCacheUsage(response.data.usage),
  };
};

/**
 * Streaming variant for Deepseek — SSE stream via axios.
 * @param {string} model
 * @param {string} apiKey
 * @param {Array} messages
 * @param {AbortSignal|null} signal
 * @param {object|null} modelConfig
 * @param {(text: string) => void} onChunk
 * @param {(text: string) => void} [onReasoning] — thinking-mode deltas, which
 *   DeepSeek streams in full before the first answer token
 * @returns {Promise<{text: string, reasoning: string, tokensUsed: number}>}
 */
const calldeepseekAPIStream = async (model, apiKey, messages, signal = null, modelConfig = null, onChunk, onReasoning, reasoningRequest = {}) => {
  const body = buildDeepseekBody(model, messages, modelConfig, reasoningRequest);
  body.stream = true;
  // Without this, DeepSeek never emits a usage-bearing chunk during a
  // stream — the call would silently bill 0 tokens.
  body.stream_options = { include_usage: true };

  let response;
  try {
    response = await axios.post(DEEPSEEK_URL, body, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        Accept: 'text/event-stream',
      },
      signal,
      responseType: 'stream',
    });
  } catch (err) {
    throw await formatAxiosError(err, 'DeepSeek stream');
  }

  return new Promise((resolve, reject) => {
    let fullText = '';
    let fullReasoning = '';
    let tokensUsed = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;
    let buffer = '';

    response.data.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const jsonStr = trimmed.slice(6);
        if (jsonStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const deltaObj = parsed.choices?.[0]?.delta || {};
          // DeepSeek names this reasoning_content; vLLM and other
          // OpenAI-compatible hosts settled on plain `reasoning`.
          const reasoningDelta = deltaObj.reasoning_content || deltaObj.reasoning;
          if (reasoningDelta) {
            fullReasoning += reasoningDelta;
            if (onReasoning) onReasoning(reasoningDelta);
          }
          const delta = deltaObj.content;
          if (delta) {
            fullText += delta;
            if (onChunk) onChunk(delta);
          }
          if (parsed.usage?.total_tokens) {
            tokensUsed = parsed.usage.total_tokens;
          }
          if (parsed.usage) {
            const c = extractCacheUsage(parsed.usage);
            if (c.cacheReadTokens || c.cacheCreationTokens) {
              cacheCreationTokens = c.cacheCreationTokens;
              cacheReadTokens = c.cacheReadTokens;
            }
          }
        } catch { /* skip */ }
      }
    });

    response.data.on('end', () => resolve({
      text: fullText, reasoning: fullReasoning, tokensUsed, cacheCreationTokens, cacheReadTokens,
    }));
    response.data.on('error', (err) => reject(err));

    if (signal) {
      signal.addEventListener('abort', () => {
        response.data.destroy();
        reject({ name: 'AbortError' });
      }, { once: true });
    }
  });
};

module.exports = { calldeepseekAPI, calldeepseekAPIStream };