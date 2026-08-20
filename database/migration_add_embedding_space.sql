-- ============================================================
-- FILE: database/migration_add_embedding_space.sql
-- PURPOSE: Tag every stored vector with the embedding SPACE (model identity)
--          that produced it, and make every vector search filter on it.
--
--   A cosine comparison between vectors from two different models returns a
--   number, never an error. Before this migration, uploaded_files_rag,
--   message_embeddings and query_cache stored no provenance at all, so
--   match_topic_files / search_memory / match_query_cache compared whatever
--   they found. That was latent while every write hardcoded 'openrouter';
--   it becomes a live corruption bug the moment embedText can fail over.
--
--   Space, not provider, is the correct key: 'openrouter' and 'openai' both
--   serve text-embedding-3-small, so their vectors are interchangeable, while
--   gemini (768d) and mistral (1024d) are separate spaces.
--
-- BACKFILL SAFETY: every existing row was written by a hardcoded 'openrouter'
--   call path (and rag_chunks' 'openai' default is the same model), so the
--   whole existing corpus belongs to 'openai-te3-small'. No re-indexing needed.
--
-- IDEMPOTENT: safe to re-run.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. Add the space column where provenance is missing entirely
-- ─────────────────────────────────────────────
ALTER TABLE uploaded_files_rag  ADD COLUMN IF NOT EXISTS embedding_space TEXT;
ALTER TABLE message_embeddings  ADD COLUMN IF NOT EXISTS embedding_space TEXT;
ALTER TABLE query_cache         ADD COLUMN IF NOT EXISTS embedding_space TEXT;
ALTER TABLE rag_chunks          ADD COLUMN IF NOT EXISTS embedding_space TEXT;
ALTER TABLE rag_documents       ADD COLUMN IF NOT EXISTS embedding_space TEXT;
ALTER TABLE uploaded_files      ADD COLUMN IF NOT EXISTS embedding_space TEXT;

-- ─────────────────────────────────────────────
-- 2. Backfill: the entire existing corpus is text-embedding-3-small
-- ─────────────────────────────────────────────
UPDATE uploaded_files_rag  SET embedding_space = 'openai-te3-small' WHERE embedding_space IS NULL;
UPDATE message_embeddings  SET embedding_space = 'openai-te3-small' WHERE embedding_space IS NULL;
UPDATE query_cache         SET embedding_space = 'openai-te3-small' WHERE embedding_space IS NULL;
UPDATE uploaded_files      SET embedding_space = 'openai-te3-small' WHERE embedding_space IS NULL;

-- rag_chunks / rag_documents already carry a provider; map it rather than assume.
UPDATE rag_chunks SET embedding_space = CASE
  WHEN provider = 'gemini'  THEN 'gemini-embed-001'
  WHEN provider = 'mistral' THEN 'mistral-embed'
  ELSE 'openai-te3-small'
END WHERE embedding_space IS NULL;

UPDATE rag_documents SET embedding_space = CASE
  WHEN provider = 'gemini'  THEN 'gemini-embed-001'
  WHEN provider = 'mistral' THEN 'mistral-embed'
  ELSE 'openai-te3-small'
END WHERE embedding_space IS NULL;

-- New rows default to the common space; the app always writes it explicitly.
ALTER TABLE uploaded_files_rag  ALTER COLUMN embedding_space SET DEFAULT 'openai-te3-small';
ALTER TABLE message_embeddings  ALTER COLUMN embedding_space SET DEFAULT 'openai-te3-small';
ALTER TABLE query_cache         ALTER COLUMN embedding_space SET DEFAULT 'openai-te3-small';
ALTER TABLE rag_chunks          ALTER COLUMN embedding_space SET DEFAULT 'openai-te3-small';
ALTER TABLE rag_documents       ALTER COLUMN embedding_space SET DEFAULT 'openai-te3-small';
ALTER TABLE uploaded_files      ALTER COLUMN embedding_space SET DEFAULT 'openai-te3-small';

-- knowledge_chunks needs no column: rag2 already resolves the provider from
-- knowledge_collections.embedding_provider and groups queries by it.

-- ─────────────────────────────────────────────
-- 3. Indexes to keep the added filter cheap
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ufr_space   ON uploaded_files_rag(embedding_space);
CREATE INDEX IF NOT EXISTS idx_msgemb_space ON message_embeddings(embedding_space);
CREATE INDEX IF NOT EXISTS idx_qcache_space ON query_cache(embedding_space);
CREATE INDEX IF NOT EXISTS idx_ragchunks_space ON rag_chunks(embedding_space);

-- ─────────────────────────────────────────────
-- 4. Re-declare the search functions with a space filter.
--
--    space_param defaults to 'openai-te3-small' so a caller that has not been
--    updated yet keeps hitting exactly the rows it hit before this migration.
--    Passing NULL explicitly disables the filter (diagnostics only).
--
--    Each old signature MUST be dropped first. Adding a trailing defaulted
--    parameter does not replace a function in Postgres — it declares an
--    overload, and every existing 4-argument call then resolves to two equally
--    valid candidates and fails with "function is not unique". PostgREST,
--    which calls these by named argument, hits the same ambiguity.
-- ─────────────────────────────────────────────

DROP FUNCTION IF EXISTS match_topic_files(vector, UUID, FLOAT, INT);
DROP FUNCTION IF EXISTS match_documents(vector, TEXT, FLOAT, INT);
DROP FUNCTION IF EXISTS match_documents(vector, FLOAT, INT);
DROP FUNCTION IF EXISTS search_memory(vector, UUID, UUID, FLOAT, INT);
DROP FUNCTION IF EXISTS match_query_cache(vector, TEXT, FLOAT, INT, UUID, UUID);
DROP FUNCTION IF EXISTS insert_rag_document(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, vector, TEXT);
-- Also the pre-p_original_file_b64 8-argument version. It has been orphaned
-- since binary storage was added and no caller can reach it, but leaving it in
-- place keeps a second candidate around for any future signature change.
DROP FUNCTION IF EXISTS insert_rag_document(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, vector);

-- match_topic_files: had NO provenance filter at all. This is the primary
-- buildRAGContext path, so it was the widest exposure.
CREATE OR REPLACE FUNCTION match_topic_files(
  query_embedding vector(1536),
  p_topic_id      UUID,
  match_threshold FLOAT DEFAULT 0.4,
  match_count     INT DEFAULT 3,
  space_param     TEXT DEFAULT 'openai-te3-small'
)
RETURNS TABLE (
  id UUID, title TEXT, content TEXT, similarity FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    uf.id,
    uf.file_name AS title,
    COALESCE(uf.llm_analysis, uf.original_content) AS content,
    1 - (uf.embedding <=> query_embedding) AS similarity
  FROM uploaded_files_rag uf
  WHERE uf.topic_id = p_topic_id
    AND uf.embedding IS NOT NULL
    AND (space_param IS NULL OR uf.embedding_space = space_param)
    AND 1 - (uf.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- search_uploaded_files: filtered on provider, which conflated openrouter and
-- openai (same model, so they should share) while trusting the label blindly.
DROP FUNCTION IF EXISTS search_uploaded_files(vector, UUID, TEXT, INT, UUID);
CREATE OR REPLACE FUNCTION search_uploaded_files(
  query_embedding vector(1536),
  user_id_param   UUID,
  provider_param  TEXT,
  match_count     INT DEFAULT 5,
  topic_id_param  UUID DEFAULT NULL,
  space_param     TEXT DEFAULT 'openai-te3-small'
)
RETURNS TABLE (
  file_id     UUID,
  file_name   TEXT,
  chunk_text  TEXT,
  chunk_index INT,
  similarity  FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.id, f.file_name, c.chunk_text, c.chunk_index,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM rag_chunks c
  JOIN uploaded_files f ON c.file_id = f.id
  WHERE f.user_id = user_id_param
    AND (topic_id_param IS NULL OR f.topic_id = topic_id_param)
    -- Space supersedes provider: openrouter and openai rows are the same model
    -- and must match each other, which a provider equality test forbids.
    AND (space_param IS NULL OR c.embedding_space = space_param)
    AND 1 - (c.embedding <=> query_embedding) > 0.4
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),
  provider_param  TEXT,
  match_threshold FLOAT DEFAULT 0.4,
  match_count     INT DEFAULT 5,
  space_param     TEXT DEFAULT 'openai-te3-small'
)
RETURNS TABLE (
  id UUID, title TEXT, content TEXT, similarity FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    rag_documents.id,
    rag_documents.title,
    rag_documents.content,
    1 - (rag_documents.embedding <=> query_embedding) AS similarity
  FROM rag_documents
  WHERE (space_param IS NULL OR rag_documents.embedding_space = space_param)
    AND 1 - (rag_documents.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- search_memory: cross-chat memory recall, previously provenance-blind.
CREATE OR REPLACE FUNCTION search_memory(
  query_embedding vector(1536),
  p_user_id       UUID,
  p_exclude_topic UUID DEFAULT NULL,
  match_threshold FLOAT DEFAULT 0.5,
  match_count     INT DEFAULT 5,
  space_param     TEXT DEFAULT 'openai-te3-small'
)
RETURNS TABLE (
  content    TEXT,
  role       TEXT,
  topic_id   UUID,
  similarity FLOAT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    me.content,
    me.role,
    me.topic_id,
    1 - (me.embedding <=> query_embedding) AS similarity,
    me.created_at
  FROM message_embeddings me
  WHERE me.user_id = p_user_id
    AND (p_exclude_topic IS NULL OR me.topic_id != p_exclude_topic)
    AND (space_param IS NULL OR me.embedding_space = space_param)
    AND 1 - (me.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- match_query_cache: a cross-space false hit here serves one user's cached
-- answer for an unrelated question, so this filter is the highest-stakes one.
CREATE OR REPLACE FUNCTION match_query_cache(
  query_embedding vector(1536),
  model_param     TEXT,
  match_threshold FLOAT DEFAULT 0.92,
  match_count     INT DEFAULT 1,
  user_id_param   UUID DEFAULT NULL,
  topic_id_param  UUID DEFAULT NULL,
  space_param     TEXT DEFAULT 'openai-te3-small'
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
    AND query_cache.user_id IS NOT DISTINCT FROM user_id_param
    AND query_cache.topic_id IS NOT DISTINCT FROM topic_id_param
    AND (space_param IS NULL OR query_cache.embedding_space = space_param)
    AND 1 - (query_cache.query_embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- ─────────────────────────────────────────────
-- 5. insert_rag_document — accept the space as a trailing optional param so
--    existing call sites keep working during rollout.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION insert_rag_document(
  p_user_id           UUID,
  p_topic_id          UUID,
  p_file_name         TEXT,
  p_file_hash         TEXT,
  p_file_type         TEXT,
  p_original_content  TEXT,
  p_llm_analysis      TEXT,
  p_embedding         vector(1536),
  p_original_file_b64 TEXT DEFAULT NULL,
  p_embedding_space   TEXT DEFAULT 'openai-te3-small'
)
RETURNS TABLE (id UUID)
LANGUAGE plpgsql AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO uploaded_files_rag (
    user_id, topic_id, file_name, file_hash, file_type,
    original_content, llm_analysis, embedding, embedding_space,
    original_file_data
  ) VALUES (
    p_user_id, p_topic_id, p_file_name, p_file_hash, p_file_type,
    p_original_content, p_llm_analysis, p_embedding, p_embedding_space,
    CASE WHEN p_original_file_b64 IS NULL THEN NULL ELSE decode(p_original_file_b64, 'base64') END
  )
  RETURNING uploaded_files_rag.id INTO v_id;

  RETURN QUERY SELECT v_id;
END;
$$;

COMMIT;
