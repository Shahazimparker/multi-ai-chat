-- ============================================================
-- FILE: database/migration_add_knowledge_graph.sql
-- PURPOSE: Entity/relation graph over knowledge_chunks, so retrieval can
--          answer questions whose answer is not contained in any one chunk.
--
--   THE GAP. Dense and sparse retrieval both ask "which chunk looks most like
--   this query?". That cannot answer a question whose answer is DERIVED from
--   two chunks — "which Tier A shapes appear in the swimlane example?" needs a
--   fact from one passage joined to a fact from another. No similarity
--   threshold reaches it, because the answer is not textually similar to the
--   question; it is assembled from places that each hold half of it.
--
--   THE SHAPE. Extraction (done by the application, not here) records entities
--   and the relations between them, plus which chunk each came from. At query
--   time the graph is entered by name-matching the query against entities, then
--   walked one hop along relations, and the chunks behind those entities are
--   returned.
--
--   HOW IT PLUGS IN. match_knowledge_graph returns EXACTLY the column shape of
--   match_knowledge_chunks, so the application fuses it by rank alongside the
--   dense and sparse passes and reranks the union. Graph retrieval is therefore
--   another opinion about which chunks matter, not a separate pipeline — and
--   when the graph is empty it simply contributes nothing.
--
-- IDEMPOTENT: safe to re-run.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────
-- 1. Entities
--
--    Scoped per collection: the same word means different things in different
--    corpora, and merging across collections would leak one user's vocabulary
--    into another's retrieval.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_entities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id   UUID NOT NULL REFERENCES knowledge_collections(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,              -- as written in the source
  normalized_name TEXT NOT NULL,              -- lowercased/trimmed, the dedupe key
  entity_type     TEXT,                       -- person, product, concept, code, ...
  description     TEXT,
  mention_count   INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- One row per distinct entity per collection. Extraction upserts on this.
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_entities_unique
  ON knowledge_entities(collection_id, normalized_name);

-- Entry point into the graph: match query wording against entity names.
CREATE INDEX IF NOT EXISTS idx_knowledge_entities_name_tsv
  ON knowledge_entities USING GIN (to_tsvector('english', name));

-- Exact-identifier lookups ("mxgraph.flowchart.decision") are the common case
-- and tsvector mangles them, so support prefix/substring matching too.
CREATE INDEX IF NOT EXISTS idx_knowledge_entities_normalized
  ON knowledge_entities(normalized_name text_pattern_ops);

-- ─────────────────────────────────────────────
-- 2. Which chunks mention which entity
--
--    This is what turns a graph hit back into retrievable text. Without it the
--    graph could name an answer but not cite it.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_entity_chunks (
  entity_id  UUID NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
  chunk_id   UUID NOT NULL REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
  PRIMARY KEY (entity_id, chunk_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_entity_chunks_chunk
  ON knowledge_entity_chunks(chunk_id);

-- ─────────────────────────────────────────────
-- 3. Relations
--
--    chunk_id is kept for provenance: a relation the model inferred should be
--    traceable to the passage it came from.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_relations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id    UUID NOT NULL REFERENCES knowledge_collections(id) ON DELETE CASCADE,
  source_entity_id UUID NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
  target_entity_id UUID NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
  relation         TEXT NOT NULL,
  chunk_id         UUID REFERENCES knowledge_chunks(id) ON DELETE SET NULL,
  weight           REAL NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_relations_source ON knowledge_relations(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_relations_target ON knowledge_relations(target_entity_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_relations_collection ON knowledge_relations(collection_id);

-- Repeated extraction of the same fact should strengthen it, not duplicate it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_relations_unique
  ON knowledge_relations(source_entity_id, target_entity_id, relation);

-- ─────────────────────────────────────────────
-- 4. Graph retrieval
--
--    Returns chunks, in the same shape as match_knowledge_chunks, ranked by how
--    strongly they are connected to the entities the query names.
--
--    `similarity` here is a normalised connection strength, NOT a cosine. It
--    exists so the caller can treat all three passes uniformly; fusion is by
--    RANK precisely because these units are not comparable.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_knowledge_graph(
  query_text      TEXT,
  collection_ids  UUID[],
  user_id_param   UUID,
  match_count     INT DEFAULT 8,
  max_hops        INT DEFAULT 1
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
  normalized TEXT;
BEGIN
  q := websearch_to_tsquery('english', coalesce(query_text, ''));
  normalized := lower(coalesce(query_text, ''));

  RETURN QUERY
  WITH accessible AS (
    SELECT col.id
    FROM knowledge_collections col
    WHERE (col.user_id = user_id_param OR col.is_public = true)
      AND (collection_ids IS NULL
           OR array_length(collection_ids, 1) IS NULL
           OR col.id = ANY(collection_ids))
  ),
  -- Entry: entities the query names, either by word match or because the
  -- query contains the entity name literally (identifiers, codes, SKUs).
  seed AS (
    SELECT e.id, 1.0::FLOAT AS strength
    FROM knowledge_entities e
    JOIN accessible a ON a.id = e.collection_id
    WHERE (q IS NOT NULL AND q <> ''::tsquery AND to_tsvector('english', e.name) @@ q)
       OR (length(e.normalized_name) >= 3 AND position(e.normalized_name IN normalized) > 0)
  ),
  -- One hop out. Neighbours are weaker evidence than a direct hit, so they
  -- carry half the strength and cannot outrank a seed on their own.
  expanded AS (
    SELECT s.id, s.strength FROM seed s
    UNION
    SELECT CASE WHEN r.source_entity_id = s.id THEN r.target_entity_id ELSE r.source_entity_id END,
           (s.strength * 0.5)::FLOAT
    FROM seed s
    JOIN knowledge_relations r
      ON (r.source_entity_id = s.id OR r.target_entity_id = s.id)
    WHERE max_hops >= 1
  ),
  -- Collapse duplicate paths to an entity, keeping its best strength.
  entity_scores AS (
    SELECT id, MAX(strength) AS strength
    FROM expanded
    GROUP BY id
  ),
  -- A chunk connected to several named entities is more likely to be the
  -- passage that joins them, which is the whole point of graph retrieval.
  chunk_scores AS (
    SELECT ec.chunk_id AS cid, SUM(es.strength) AS score
    FROM entity_scores es
    JOIN knowledge_entity_chunks ec ON ec.entity_id = es.id
    GROUP BY ec.chunk_id
  )
  SELECT
    kc.id,
    kd.id,
    col.id,
    col.name,
    kd.title,
    kd.source_type,
    kd.source_url,
    kc.chunk_text,
    COALESCE(kc.parent_text, kc.chunk_text),
    kc.chunk_index,
    kc.metadata,
    (cs.score / (1 + cs.score))::FLOAT
  FROM chunk_scores cs
  JOIN knowledge_chunks kc ON kc.id = cs.cid
  JOIN knowledge_documents kd ON kd.id = kc.document_id
  JOIN knowledge_collections col ON col.id = kc.collection_id
  WHERE kd.status = 'indexed'
  ORDER BY cs.score DESC
  LIMIT match_count;
END;
$$;

COMMIT;

-- ─────────────────────────────────────────────
-- VERIFY (run separately)
--
--   SELECT count(*) FROM knowledge_entities;
--   SELECT count(*) FROM knowledge_relations;
--
--   SELECT document_title, left(chunk_text, 70), round(similarity::numeric, 3)
--   FROM match_knowledge_graph('<a term you know is in the corpus>', NULL,
--                              '<your-user-uuid>', 5, 1);
-- ─────────────────────────────────────────────
