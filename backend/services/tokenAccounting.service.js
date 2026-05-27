const { estimateTokens } = require('./tokenBudget.service');

/**
 * @param {import('../types/chat-contracts').BillableTokenInput} params
 */
const calculateBillableTokens = ({
  totalAITokens = 0,
  promptTokens = 0,
  finalReply = '',
  totalEmbeddingTokens = 0,
  estimatedInputTokens = 0,
  compressTokens = 0,
  historySummaryTokens = 0,
}) => {
  const summaryTokens = historySummaryTokens || 0;

  if (totalAITokens > 0) {
    return totalAITokens + totalEmbeddingTokens + estimatedInputTokens + compressTokens + summaryTokens;
  }

  return (
    promptTokens +
    estimateTokens(finalReply || '') +
    totalEmbeddingTokens +
    estimatedInputTokens +
    compressTokens +
    summaryTokens
  );
};

module.exports = {
  calculateBillableTokens,
};
