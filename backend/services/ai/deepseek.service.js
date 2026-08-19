// ============================================================
// FILE: backend/services/ai/deepseek.service.js
// PURPOSE: Calls Deepseek flash
// ============================================================

const axios = require('axios');

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

/**
 * Shared helper to build Deepseek request body.
 */
function buildDeepseekBody(model, messages, modelConfig) {
  const body = {
    model,
    messages,
    max_tokens: 16000,
    temperature: modelConfig?.temperature ?? 0.7,
  };

  if (modelConfig?.reasoning) {
    if (modelConfig.reasoning.thinking) {
      body.thinking = { type: modelConfig.reasoning.thinking };
    }
    if (modelConfig.reasoning.reasoningEffort) {
      body.reasoning_effort = modelConfig.reasoning.reasoningEffort;
    }
  }
  return body;
}

const calldeepseekAPI = async (model, apiKey, messages, signal = null, modelConfig = null) => {
  const body = buildDeepseekBody(model, messages, modelConfig);
  const response = await axios.post(DEEPSEEK_URL, body, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
    signal,
  });

  const message = response.data.choices[0].message;
  return {
    text: message.content,
    // Thinking mode returns the chain of thought beside the answer, not inside
    // it. Without this the reasoning tokens are billed and then discarded.
    reasoning: message.reasoning_content || message.reasoning || '',
    tokensUsed: response.data.usage?.total_tokens || 0,
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
const calldeepseekAPIStream = async (model, apiKey, messages, signal = null, modelConfig = null, onChunk, onReasoning) => {
  const body = buildDeepseekBody(model, messages, modelConfig);
  body.stream = true;

  const response = await axios.post(DEEPSEEK_URL, body, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      Accept: 'text/event-stream',
    },
    signal,
    responseType: 'stream',
  });

  return new Promise((resolve, reject) => {
    let fullText = '';
    let fullReasoning = '';
    let tokensUsed = 0;
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
        } catch { /* skip */ }
      }
    });

    response.data.on('end', () => resolve({ text: fullText, reasoning: fullReasoning, tokensUsed }));
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