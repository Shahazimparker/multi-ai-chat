-- ============================================================
-- FILE: database/migration_add_knowledge_fts.sql
-- PURPOSE: Add true sparse (keyword) retrieval to knowledge_chunks, so it can
--          be fused with dense vector retrieval instead of approximated after
--          the fact.
--
--   The BM25/Jaccard scoring in rag.service.js and rag2.service.js runs in
--   JavaScript over the rows the VECTOR search already returned. That cannot
--   recover a chunk the embedder missed: a chunk containing an exact error
--   code, SKU, version string or identifier never enters the candidate set in
--   the first place, so no amount of re-scoring will surface it.
--
--   This adds a real inverted index. Retrieval then runs two independent
--   passes — dense (semantic) and sparse (lexical) — and fuses the candidate
--   lists. The cross-encoder reranker decides the final ordering, so fusion
--   only has to maximise RECALL; precision is someone else's job.
--
-- COST: one GENERATED column plus a GIN index on knowledge_chunks. The column
--   is STORED and computed by Postgres, so no application change is needed to
--   populate it and no re-embedding is involved.
--
-- IDEMPOTENT: safe to re-run.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. Generated tsvector column
--
--    to_tsvector('english', ...) with an EXPLICIT regconfig is IMMUTABLE, which
--    a generated column requires. The single-argument form is only STABLE
--    (it reads default_text_search_config) and Postgres will reject it here.
--
--    Weighting: the section heading a chunk sits under is a strong signal for
--    keyword search, so it is indexed at weight A and the body at weight B.
-- ─────────────────────────────────────────────
ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS chunk_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(metadata->>'sectionTitle', '')), 'A') ||
    setweight(to_tsvector('english', coalesce(chunk_text, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_tsv
  ON knowledge_chunks USING GIN (chunk_tsv);

-- ─────────────────────────────────────────────
-- 2. Sparse retrieval RPC
--
--    Mirrors match_knowledge_chunks exactly — same columns, same access rules
--    — so the two candidate lists can be fused without reshaping either.
--    `similarity` carries the normalised text rank so the application can treat
--    both passes uniformly; it is NOT a cosine value and must not be compared
--    against one. Fusion is by RANK, not by score, precisely for that reason.
--
--    websearch_to_tsquery parses human queries safely: it handles quoted
--    phrases, OR and negation, and never raises on punctuation the way
--    to_tsquery does. A query of nothing but stopwords yields an empty tsquery,
--    which simply matches no rows.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_knowledge_chunks_fts(
  query_text        TEXT,
  collection_ids    UUID[],
  user_id_param     UUID,
  match_count       INT DEFAULT 8
)
RETURNS TABLE (
  chunk_id          UUID,
  document_id       UUID,
  collection_id     UUID,
  collection_name   TEXT,
  document_title    TEXT,
  source_type       TEXT,
  source_url        TEXT,
  chunk_text        TEXT,
  parent_text       TEXT,
  chunk_index       INT,
  chunk_metadata    JSONB,
  similarity        FLOAT
)
LANGUAGE plpgsql AS $$
DECLARE
  q tsquery;
BEGIN
  q := websearch_to_tsquery('english', coalesce(query_text, ''));

  -- No indexable term in the query (empty input, or all stopwords).
  IF q IS NULL OR q = ''::tsquery THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    kc.id AS chunk_id,
    kd.id AS document_id,
    col.id AS collection_id,
    col.name AS collection_name,
    kd.title AS document_title,
    kd.source_type AS source_type,
    kd.source_url AS source_url,
    kc.chunk_text,
    COALESCE(kc.parent_text, kc.chunk_text) AS parent_text,
    kc.chunk_index,
    kc.metadata AS chunk_metadata,
    -- ts_rank_cd is unbounded; map it into 0..1 so downstream code never
    -- mistakes a raw text rank for a cosine similarity.
    (ts_rank_cd(kc.chunk_tsv, q) / (1 + ts_rank_cd(kc.chunk_tsv, q)))::FLOAT AS similarity
  FROM knowledge_chunks kc
  JOIN knowledge_documents kd ON kd.id = kc.document_id
  JOIN knowledge_collections col ON col.id = kc.collection_id
  WHERE (col.user_id = user_id_param OR col.is_public = true)
    AND (collection_ids IS NULL OR array_length(collection_ids, 1) IS NULL OR col.id = ANY(collection_ids))
    AND kd.status = 'indexed'
    AND kc.chunk_tsv @@ q
  ORDER BY ts_rank_cd(kc.chunk_tsv, q) DESC
  LIMIT match_count;
END;
$$;

COMMIT;

-- ─────────────────────────────────────────────
-- VERIFY (run separately, outside the transaction)
--
--   Should return the chunks containing a literal term, including ones the
--   embedder would rank poorly:
--
--   SELECT document_title, left(chunk_text, 80), similarity
--   FROM match_knowledge_chunks_fts('<some exact term>', NULL, '<your-user-uuid>', 5);
-- ─────────────────────────────────────────────
