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
  // Accepted but intentionally NOT added to the total below (see note).
  // Kept in the signature so callers don't need special-casing, and because
  // some callers may still want the value passed through for logging.
  estimatedInputTokens = 0,
  compressTokens = 0,
  historySummaryTokens = 0,
}) => {
  // This aggregates multiple token sources into one quota unit.
  // It may include overlapping estimates in fallback paths by design.
  const summaryTokens = historySummaryTokens || 0;

  // estimatedInputTokens is NOT added here — it would double-count the user's
  // message. Providers already report input+output tokens (totalAITokens), and
  // the input side of that already includes the prompt sent, which ends with
  // the user's message. Same story in the fallback branch: promptTokens comes
  // from estimateMessagesTokens(aiMessages), and aiMessages ends with the user
  // message too. estimatedInputTokens still has legitimate uses elsewhere
  // (the per-query limit check, and the user message row's own tokens_used) —
  // it's just not a separate billable line item on top of what the AI call
  // already accounts for.
  if (totalAITokens > 0) {
    return totalAITokens + totalEmbeddingTokens + compressTokens + summaryTokens;
  }

  return (
    promptTokens +
    estimateTokens(finalReply || '') +
    totalEmbeddingTokens +
    compressTokens +
    summaryTokens
  );
};

module.exports = {
  calculateBillableTokens,
};
