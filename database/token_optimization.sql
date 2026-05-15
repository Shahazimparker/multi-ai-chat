-- Token optimization upgrade for existing Supabase projects.
-- Run this once if your database was created before semantic cache support.

ALTER TABLE query_cache
  ADD COLUMN IF NOT EXISTS query_embedding vector(1536);

ALTER TABLE query_cache
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE query_cache
  ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES topics(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS query_cache_embedding_idx
  ON query_cache USING ivfflat (query_embedding vector_cosine_ops)
  WHERE query_embedding IS NOT NULL;

CREATE OR REPLACE FUNCTION match_query_cache(
  query_embedding vector(1536),
  model_param     TEXT,
  match_threshold FLOAT DEFAULT 0.92,
  match_count     INT DEFAULT 1,
  user_id_param   UUID DEFAULT NULL,
  topic_id_param  UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID, query_text TEXT, response_text TEXT, hit_count INTEGER, similarity FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    query_cache.id,
    query_cache.query_text,
    query_cache.response_text,
    query_cache.hit_count,
    1 - (query_cache.query_embedding <=> query_embedding) AS similarity
  FROM query_cache
  WHERE query_cache.model = model_param
    AND query_cache.query_embedding IS NOT NULL
    AND (user_id_param IS NULL OR query_cache.user_id = user_id_param OR query_cache.user_id IS NULL)
    AND (topic_id_param IS NULL OR query_cache.topic_id = topic_id_param OR query_cache.topic_id IS NULL)
    AND 1 - (query_cache.query_embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;
