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
    .select('response_text, hit_count')
    .eq('query_hash', hash)
    .single();

  if (data) {
    // Increment hit count (fire-and-forget)
    supabase
      .from('query_cache')
      .update({ hit_count: (data.hit_count || 0) + 1, last_hit_at: new Date().toISOString() })
      .eq('query_hash', hash)
      .then(() => {});

    console.log('[Cache] HIT for query hash:', hash.slice(0, 8));
    return data.response_text;
  }
  return null;
};

/**
 * getSemanticCachedResponse — optional pgvector cache lookup.
 * Works after the schema has query_embedding + match_query_cache; otherwise it no-ops.
 */
const getSemanticCachedResponse = async (queryEmbedding, modelId, threshold = 0.92) => {
  if (!queryEmbedding) return null;

  try {
    const { data, error } = await supabase.rpc('match_query_cache', {
      query_embedding: queryEmbedding,
      model_param: modelId,
      match_threshold: threshold,
      match_count: 1,
    });

    if (error || !data?.length) return null;

    const hit = data[0];
    supabase
      .from('query_cache')
      .update({ hit_count: (hit.hit_count || 0) + 1, last_hit_at: new Date().toISOString() })
      .eq('id', hit.id)
      .then(() => {});

    console.log('[Cache] SEMANTIC HIT:', Math.round((hit.similarity || 0) * 100), '%');
    return hit.response_text;
  } catch {
    return null;
  }
};

/**
 * setCachedResponse — stores a response in cache
 * Skips very short or error responses
 */
const setCachedResponse = async (query, modelId, response, queryEmbedding = null) => {
  if (!response || response.length < 20) return; // skip trivial responses

  const hash = hashQuery(query, modelId);
  const payload = {
    query_hash:    hash,
    query_text:    query.slice(0, 1000), // cap stored text
    response_text: response,
    model:         modelId,
    hit_count:     1,
    last_hit_at:   new Date().toISOString(),
  };

  if (queryEmbedding) payload.query_embedding = queryEmbedding;

  const { error } = await supabase
    .from('query_cache')
    .upsert(payload, { onConflict: 'query_hash' });

  // Existing databases may not have query_embedding yet. Keep exact cache working.
  if (error && queryEmbedding) {
    delete payload.query_embedding;
    await supabase
      .from('query_cache')
      .upsert(payload, { onConflict: 'query_hash' });
  }
};

module.exports = { getCachedResponse, getSemanticCachedResponse, setCachedResponse };
