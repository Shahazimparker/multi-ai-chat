// ============================================================
// FILE: backend/services/cache.service.js
// PURPOSE: Caches AI responses for repeated/identical queries
//          Uses SHA-256 hash of (normalizedQuery + modelId) as key
//          Cache hits update hit_count and last_hit_at
// ============================================================

const crypto   = require('crypto');
const supabase = require('../config/supabase');

/**
 * hashQuery — normalize and hash query+model for cache key
 */
const hashQuery = (query, modelId) => {
  const normalized = query.toLowerCase().replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(`${normalized}::${modelId}`).digest('hex');
};

/**
 * getCachedResponse — returns cached response or null
 */
const getCachedResponse = async (query, modelId) => {
  const hash = hashQuery(query, modelId);

  const { data } = await supabase
    .from('query_cache')
    .select('response_text')
    .eq('query_hash', hash)
    .single();

  if (data) {
    // Increment hit count (fire-and-forget)
    supabase
      .from('query_cache')
      .update({ hit_count: supabase.rpc('hit_count + 1'), last_hit_at: new Date().toISOString() })
      .eq('query_hash', hash)
      .then(() => {});

    console.log('[Cache] HIT for query hash:', hash.slice(0, 8));
    return data.response_text;
  }
  return null;
};

/**
 * setCachedResponse — stores a response in cache
 * Skips very short or error responses
 */
const setCachedResponse = async (query, modelId, response) => {
  if (!response || response.length < 20) return; // skip trivial responses

  const hash = hashQuery(query, modelId);

  await supabase
    .from('query_cache')
    .upsert({
      query_hash:    hash,
      query_text:    query.slice(0, 1000), // cap stored text
      response_text: response,
      model:         modelId,
      hit_count:     1,
      last_hit_at:   new Date().toISOString(),
    }, { onConflict: 'query_hash' });
};

module.exports = { getCachedResponse, setCachedResponse };
