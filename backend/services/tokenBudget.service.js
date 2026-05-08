// FILE: backend/services/tokenBudget.service.js
// PURPOSE: Lightweight prompt budgeting so RAG, files, and history cannot grow without bounds.

const CHARS_PER_TOKEN = 4;

const estimateTokens = (text = '') => Math.ceil(String(text).length / CHARS_PER_TOKEN);

const trimTextByTokens = (text = '', maxTokens = 0) => {
  if (!text || maxTokens <= 0) return '';
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 16)).trim()}...`;
};

const trimMessageContent = (message, maxTokens) => ({
  ...message,
  content: trimTextByTokens(message.content, maxTokens),
});

const estimateMessagesTokens = (messages = []) => (
  messages.reduce((sum, message) => sum + estimateTokens(message.content) + 4, 0)
);

const fitMessagesToBudget = (messages, maxPromptTokens) => {
  const result = [];
  let remaining = maxPromptTokens;

  for (const message of messages) {
    const estimated = estimateTokens(message.content) + 4;
    if (estimated <= remaining) {
      result.push(message);
      remaining -= estimated;
      continue;
    }

    const minimumUsefulTokens = message.role === 'user' ? 80 : 120;
    if (remaining >= minimumUsefulTokens) {
      result.push(trimMessageContent(message, remaining - 4));
      remaining = 0;
    }
    break;
  }

  return result;
};

const trimContextBlock = (block, maxTokens) => trimTextByTokens(block, maxTokens);

const createPromptBudget = (modelConfig = {}) => {
  const modelLimit = modelConfig.maxTokens || 4096;
  const reservedOutputTokens = Math.min(1600, Math.max(800, Math.floor(modelLimit * 0.35)));
  const maxPromptTokens = Math.max(1200, modelLimit - reservedOutputTokens);

  return {
    maxPromptTokens,
    systemTokens: Math.floor(maxPromptTokens * 0.34),
    historyTokens: Math.floor(maxPromptTokens * 0.28),
    ragTokens: Math.floor(maxPromptTokens * 0.18),
    fileTokens: Math.floor(maxPromptTokens * 0.16),
    queryTokens: Math.floor(maxPromptTokens * 0.18),
  };
};

module.exports = {
  CHARS_PER_TOKEN,
  createPromptBudget,
  estimateMessagesTokens,
  estimateTokens,
  fitMessagesToBudget,
  trimContextBlock,
  trimTextByTokens,
};
