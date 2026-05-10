const supabase = require('../config/supabase');

const logAnalytics = async ({
  userId,
  query,
  modelId,
  tokensUsed,
  isAnonymous,
  cacheHit,
  responseTimeMs,
}) => {
  try {
    await supabase.from('query_analytics').insert({
      user_id: userId || null,
      query_text: (query || '').slice(0, 500),
      model: modelId,
      tokens_used: tokensUsed || 0,
      is_anonymous: !!isAnonymous,
      cache_hit: !!cacheHit,
      response_time_ms: responseTimeMs,
    });
  } catch (e) {
    console.error('[Analytics] Log failed:', e.message);
  }
};

module.exports = { logAnalytics };
