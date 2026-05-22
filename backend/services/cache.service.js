// ============================================================
// FILE: backend/services/cache.service.js
// PURPOSE: Caches AI responses for repeated/identical queries
//          Uses SHA-256 hash of (normalizedQuery + modelId) as key
//          Cache hits update hit_count and last_hit_at
// ============================================================

const crypto   = require('crypto');
const supabase = require('../config/supabase');

/**
 * hashQuery — normalize and hash query+model for cache key.
 * Includes userId and topicId for per-user/per-topic isolation.
 */
const hashQuery = (query, modelId, userId = null, topicId = null) => {
  const normalized = query.toLowerCase().replace(/\s+/g, ' ').trim();
  const key = `${normalized}::${modelId}::${userId || ''}::${topicId || ''}`;
  return crypto.createHash('sha256').update(key).digest('hex');
};

/**
 * getCachedResponse — returns cached response or null.
 * Filters by userId/topicId for topic-scoped isolation.
 */
const getCachedResponse = async (query, modelId, userId = null, topicId = null) => {
  const hash = hashQuery(query, modelId, userId, topicId);

  let queryBuilder = supabase
    .from('query_cache')
    .select('response_text, hit_count')
    .eq('query_hash', hash);

  if (userId) queryBuilder = queryBuilder.eq('user_id', userId);
  if (topicId) queryBuilder = queryBuilder.eq('topic_id', topicId);

  const { data } = await queryBuilder.maybeSingle();

  if (data) {
    // Fire increment asynchronously — catch errors to prevent unhandled rejection
    supabase
      .from('query_cache')
      .update({ hit_count: (data.hit_count || 0) + 1, last_hit_at: new Date().toISOString() })
      .eq('query_hash', hash)
      .then(() => {})
      .catch(err => console.warn('[Cache] Hit counter update failed:', err.message));

    console.log('[Cache] HIT for query hash:', hash.slice(0, 8));
    return data.response_text;
  }
  return null;
};

/**
 * getSemanticCachedResponse — optional pgvector cache lookup.
 * Filters by userId/topicId for topic-scoped isolation.
 * Works after the schema has query_embedding + match_query_cache; otherwise it no-ops.
 */
const getSemanticCachedResponse = async (queryEmbedding, modelId, threshold = 0.92, userId = null, topicId = null) => {
  if (!queryEmbedding) return null;

  try {
    const { data, error } = await supabase.rpc('match_query_cache', {
      query_embedding: queryEmbedding,
      model_param: modelId,
      match_threshold: threshold,
      match_count: 1,
      user_id_param: userId,
      topic_id_param: topicId,
    });

    if (error || !data?.length) return null;

    const hit = data[0];
    supabase
      .from('query_cache')
      .update({ hit_count: (hit.hit_count || 0) + 1, last_hit_at: new Date().toISOString() })
      .eq('id', hit.id)
      .then(() => {})
      .catch(err => console.warn('[Cache] Semantic hit counter update failed:', err.message));

    console.log('[Cache] SEMANTIC HIT:', Math.round((hit.similarity || 0) * 100), '%');
    return hit.response_text;
  } catch {
    return null;
  }
};

/**
 * setCachedResponse — stores a response in cache
 * Skips very short or error responses.
 * Stores userId and topicId for topic-scoped isolation.
 */
const setCachedResponse = async (query, modelId, response, queryEmbedding = null, userId = null, topicId = null) => {
  if (!response || response.length < 20) return; // skip trivial responses

  const hash = hashQuery(query, modelId, userId, topicId);
  const payload = {
    query_hash:    hash,
    query_text:    query.slice(0, 1000), // cap stored text
    response_text: response,
    model:         modelId,
    hit_count:     1,
    last_hit_at:   new Date().toISOString(),
  };

  if (userId)   payload.user_id = userId;
  if (topicId)  payload.topic_id = topicId;
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

/**
 * cleanupStaleCache — Deletes cache entries older than maxAgeDays with low hit count.
 * Runs inline (awaited) so callers can determine timing.
 * @param {number} maxAgeDays - entries older than this are candidates
 * @param {number} minHits    - entries with hit_count < this AND older than maxAgeDays are deleted
 * @returns {Promise<number>} number of deleted rows
 */
const cleanupStaleCache = async (maxAgeDays = 30, minHits = 2) => {
  try {
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
    const { data, error, count } = await supabase
      .from('query_cache')
      .delete()
      .lt('last_hit_at', cutoff)
      .lt('hit_count', minHits)
      .select('id', { count: 'exact' });

    if (error) {
      console.warn('[Cache] Cleanup error:', error.message);
      return 0;
    }
    const deleted = count || 0;
    if (deleted > 0) console.log(`[Cache] Cleaned ${deleted} stale entries (>${maxAgeDays}d, <${minHits} hits)`);
    return deleted;
  } catch (err) {
    console.warn('[Cache] Cleanup failed:', err.message);
    return 0;
  }
};

module.exports = { getCachedResponse, getSemanticCachedResponse, setCachedResponse, cleanupStaleCache };
