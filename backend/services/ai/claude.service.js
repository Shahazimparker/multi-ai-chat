// ============================================================
// FILE: backend/services/ai/claude.service.js
// PURPOSE: Calls Anthropic Claude API
// ============================================================

const Anthropic = require('@anthropic-ai/sdk');

const callClaude = async (modelName, apiKey, messages) => {
  const client = new Anthropic({ apiKey });

  // Anthropic requires alternating user/assistant roles
  // Extract system message if any, separate from conversation
  const systemMsg = messages.find(m => m.role === 'system')?.content || '';
  const chatMsgs  = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role, content: m.content }));

  const response = await client.messages.create({
    model:      modelName,
    max_tokens: 4096,
    system:     systemMsg || undefined,
    messages:   chatMsgs,
  });

  const text       = response.content[0]?.text || '';
  const tokensUsed = (response.usage?.input_tokens || 0) +
                     (response.usage?.output_tokens || 0);
  return { text, tokensUsed };
};

module.exports = { callClaude };
