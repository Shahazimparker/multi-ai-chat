const supabase = require('../config/supabase');

/**
 * Records one query for the admin analytics dashboard.
 *
 * TWO DIFFERENT CACHES ARE TRACKED HERE, AND CONFLATING THEM IS A TRAP:
 *
 *   cacheHit                — the reply itself came from our own exact/semantic
 *                             response cache, so no model was called at all.
 *                             This is what the UI labels "(Cached)" and what the
 *                             cache-hit-rate tile counts.
 *   promptCache*Tokens      — the PROVIDER reused our prompt prefix from its KV
 *                             cache while still generating a fresh answer. It is
 *                             a cost metric, not a cached reply.
 *
 * They were briefly the same field. Once the adapters began reporting
 * prompt-cache reads correctly, that would have marked nearly every DeepSeek
 * reply as "cached" and pinned the hit-rate tile near 100%.
 *
 * Columns come from database/migration_add_prompt_cache_analytics.sql; the
 * insert degrades to the legacy shape if that migration has not been applied,
 * so deploying code before schema cannot start dropping analytics rows.
 */
const logAnalytics = async ({
  userId,
  query,
  modelId,
  tokensUsed,
  isAnonymous,
  cacheHit,
  promptCacheReadTokens = 0,
  promptCacheWriteTokens = 0,
  responseTimeMs,
}) => {
  const base = {
    user_id: userId || null,
    query_text: (query || '').slice(0, 500),
    model: modelId,
    tokens_used: tokensUsed || 0,
    is_anonymous: !!isAnonymous,
    cache_hit: !!cacheHit,
    response_time_ms: responseTimeMs,
  };

  // supabase-js resolves with { error } rather than throwing, so the fallback
  // has to inspect the result; a try/catch alone would never see a bad column.
  const insert = async (row) => {
    try {
      const { error } = await supabase.from('query_analytics').insert(row);
      return error || null;
    } catch (e) {
      return e;
    }
  };

  const err = await insert({
    ...base,
    prompt_cache_read_tokens: promptCacheReadTokens || 0,
    prompt_cache_write_tokens: promptCacheWriteTokens || 0,
  });
  if (!err) return;

  // PostgREST answers an unknown column with PGRST204 / "column ... does not
  // exist". Retry without the new fields so an unapplied migration costs the
  // prompt-cache detail rather than the whole analytics row.
  const missingColumn = /PGRST204/i.test(err.code || '')
    || /column .* does not exist|could not find the .* column/i.test(err.message || '');
  if (!missingColumn) {
    console.error('[Analytics] Log failed:', err.message);
    return;
  }

  const fallbackErr = await insert(base);
  if (fallbackErr) {
    console.error('[Analytics] Log failed:', fallbackErr.message);
    return;
  }
  console.warn('[Analytics] prompt_cache_* columns missing — apply database/migration_add_prompt_cache_analytics.sql to record prompt-cache savings.');
};

module.exports = { logAnalytics };
