const { estimateTokens } = require('./tokenBudget.service');

/**
 * Quota accounting note:
 * This returns an internal usage unit for user quota enforcement.
 * It is intentionally not a provider-accurate cost model (input/output pricing can differ).
 *
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
  // This aggregates multiple token sources into one quota unit.
  // It may include overlapping estimates in fallback paths by design.
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
