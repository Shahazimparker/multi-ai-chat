-- ============================================================
-- FILE: database/migration_add_rag2_knowledge_management.sql
-- PURPOSE: Schema for RAG 2.0 & Knowledge Management
--          - Collections / Knowledge Bases
--          - Multi-Source Ingestion Documents (Files, Crawls, Notes)
--          - Parent-Child Knowledge Chunks with pgvector
--          - Vector search RPC function for multi-collection search
-- ============================================================

-- Ensure pgvector extension is enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────
-- TABLE: knowledge_collections (Named knowledge bases)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_collections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  description         TEXT DEFAULT '',
  icon                TEXT DEFAULT 'folder',
  color               TEXT DEFAULT '#4d6bfe',
  embedding_provider  TEXT DEFAULT 'openrouter',
  embedding_model     TEXT DEFAULT 'text-embedding-3-small',
  is_public           BOOLEAN DEFAULT false,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Index on user_id and public collections
CREATE INDEX IF NOT EXISTS idx_knowledge_collections_user ON knowledge_collections(user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_collections_public ON knowledge_collections(is_public);

-- ─────────────────────────────────────────────
-- TABLE: knowledge_documents (Source documents in a collection)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id   UUID REFERENCES knowledge_collections(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  source_type     TEXT NOT NULL DEFAULT 'file', -- 'file' | 'web_crawl' | 'url' | 'raw_text' | 'github'
  source_url      TEXT,
  file_type       TEXT,
  file_size       INTEGER DEFAULT 0,
  doc_metadata    JSONB DEFAULT '{}',           -- e.g. { author, crawl_depth, page_count, tags }
  status          TEXT DEFAULT 'pending',       -- 'pending' | 'processing' | 'indexed' | 'failed'
  chunk_count     INTEGER DEFAULT 0,
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_collection ON knowledge_documents(collection_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_user ON knowledge_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_status ON knowledge_documents(status);

-- ─────────────────────────────────────────────
-- TABLE: knowledge_chunks (Indexed chunks with parent context)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  collection_id   UUID REFERENCES knowledge_collections(id) ON DELETE CASCADE,
  chunk_text      TEXT NOT NULL,                -- Tight chunk for vector matching (200-300 tokens)
  parent_text     TEXT,                         -- Surrounding parent context for LLM prompt (800-1200 tokens)
  chunk_index     INTEGER NOT NULL DEFAULT 0,
  embedding       vector(1536),                 -- 1536-dimensional embedding
  metadata        JSONB DEFAULT '{}',           -- { heading, page_number, tokens, source_title, source_url }
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc ON knowledge_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_collection ON knowledge_chunks(collection_id);

-- Optional HNSW vector index for ultra-fast vector search
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding ON knowledge_chunks 
USING hnsw (embedding vector_cosine_ops);

-- ─────────────────────────────────────────────
-- TABLE: topic_knowledge_collections (Link topics to collections)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS topic_knowledge_collections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id        UUID REFERENCES topics(id) ON DELETE CASCADE,
  collection_id   UUID REFERENCES knowledge_collections(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(topic_id, collection_id)
);

CREATE INDEX IF NOT EXISTS idx_topic_knowledge_collections_topic ON topic_knowledge_collections(topic_id);

-- ─────────────────────────────────────────────
-- FUNCTION: match_knowledge_chunks (Multi-collection vector search with security)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_knowledge_chunks(
  query_embedding   vector(1536),
  collection_ids    UUID[],
  user_id_param     UUID,
  match_count       INT DEFAULT 8,
  match_threshold   FLOAT DEFAULT 0.4
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
BEGIN
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
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM knowledge_chunks kc
  JOIN knowledge_documents kd ON kd.id = kc.document_id
  JOIN knowledge_collections col ON col.id = kc.collection_id
  WHERE (col.user_id = user_id_param OR col.is_public = true)
    AND (collection_ids IS NULL OR array_length(collection_ids, 1) IS NULL OR col.id = ANY(collection_ids))
    AND kd.status = 'indexed'
    AND 1 - (kc.embedding <=> query_embedding) >= match_threshold
  ORDER BY kc.embedding <=> query_embedding ASC
  LIMIT match_count;
END;
$$;
