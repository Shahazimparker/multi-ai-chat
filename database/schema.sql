-- ============================================================
-- FILE: database/schema.sql
-- PURPOSE: Complete Supabase/PostgreSQL schema for MultiAI Chat
-- Run this entire file in Supabase SQL Editor (once)
-- ============================================================

-- Enable pgvector extension for RAG (Vector Search)
CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────
-- TABLE: users (app users managed by admin)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  username        TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,                        -- bcrypt hashed
  role            TEXT NOT NULL DEFAULT 'user',         -- 'user' | 'admin'
  is_active       BOOLEAN DEFAULT true,
  total_tokens    INTEGER DEFAULT 100000,               -- lifetime token quota
  used_tokens     INTEGER DEFAULT 0,                    -- tokens consumed so far
  per_query_limit INTEGER DEFAULT 2000,                 -- max tokens per single query
  session_minutes INTEGER DEFAULT 60,                   -- session duration in minutes
  expires_at      TIMESTAMPTZ,                          -- account expiry (NULL = never)
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLE: sessions (JWT session tracking)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,             -- SHA-256 of JWT token
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLE: topics (chat topics / conversations)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS topics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT 'New Chat',        -- auto-generated from first message
  model       TEXT NOT NULL,                           -- AI model used (e.g. 'gemini-flash')
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLE: messages (individual chat messages)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id        UUID REFERENCES topics(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,          -- 'user' | 'assistant'
  content         TEXT NOT NULL,
  model           TEXT,                   -- which AI model responded
  tokens_used     INTEGER DEFAULT 0,      -- tokens consumed by this message
  is_summary      BOOLEAN DEFAULT false,  -- true if this is a compressed summary
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLE: query_cache (repeated query caching)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS query_cache (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash      TEXT UNIQUE NOT NULL,   -- SHA-256 of normalized query
  query_text      TEXT NOT NULL,
  response_text   TEXT NOT NULL,
  model           TEXT NOT NULL,
  query_embedding vector(1536),           -- optional semantic cache lookup
  hit_count       INTEGER DEFAULT 1,      -- how many times this was served from cache
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  topic_id        UUID REFERENCES topics(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  last_hit_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLE: query_analytics (all user queries for admin analytics)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS query_analytics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  query_text      TEXT NOT NULL,
  model           TEXT NOT NULL,
  tokens_used     INTEGER DEFAULT 0,
  is_anonymous    BOOLEAN DEFAULT false,
  cache_hit       BOOLEAN DEFAULT false,
  response_time_ms INTEGER,              -- how long the API took
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLE: rag_documents (RAG knowledge base)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rag_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  provider    TEXT DEFAULT 'openai',
  embedding   vector(1536),             -- text-embedding-3-small dimension
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLE: uploaded_files (Track file metadata)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS uploaded_files (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  topic_id      UUID REFERENCES topics(id) ON DELETE SET NULL,
  file_name     TEXT NOT NULL,
  file_type     TEXT,
  file_size     INTEGER,
  content_text  TEXT,
  provider      TEXT DEFAULT 'openai',  -- 'openai' or 'gemini'
  embedding     vector(1536),           -- dimension for text-embedding-3-small
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLE: rag_chunks (Individual file fragments)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rag_chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id       UUID REFERENCES uploaded_files(id) ON DELETE CASCADE,
  chunk_text    TEXT NOT NULL,
  provider      TEXT DEFAULT 'openai',
  embedding     vector(1536),
  chunk_index   INTEGER,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLE: uploaded_files_rag (File uploads with RAG embeddings)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS uploaded_files_rag (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  topic_id          UUID REFERENCES topics(id) ON DELETE SET NULL,
  file_name         TEXT NOT NULL,
  file_hash         TEXT,
  file_type         TEXT,
  original_content     TEXT,
  original_file_data   BYTEA,
  llm_analysis         TEXT,
  embedding            vector(1536),
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- FUNCTION: insert_rag_document (Insert into uploaded_files_rag)
-- Also stores original binary file data via base64 decode
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
  p_original_file_b64 TEXT DEFAULT NULL
)
RETURNS TABLE (id UUID)
LANGUAGE plpgsql AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO uploaded_files_rag (user_id, topic_id, file_name, file_hash, file_type, original_content, llm_analysis, embedding, original_file_data)
  VALUES (p_user_id, p_topic_id, p_file_name, p_file_hash, p_file_type, p_original_content, p_llm_analysis, p_embedding,
    CASE WHEN p_original_file_b64 IS NOT NULL THEN decode(p_original_file_b64, 'base64') ELSE NULL END)
  RETURNING uploaded_files_rag.id INTO v_id;

  RETURN QUERY SELECT v_id;
END;
$$;

-- ─────────────────────────────────────────────
-- FUNCTION: search_uploaded_files (Vector search)
-- ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS search_uploaded_files(vector, UUID, INT);
DROP FUNCTION IF EXISTS search_uploaded_files(vector, UUID, TEXT, INT);
DROP FUNCTION IF EXISTS search_uploaded_files(vector, UUID, TEXT, INT, UUID);
CREATE OR REPLACE FUNCTION search_uploaded_files(
  query_embedding vector(1536),
  user_id_param   UUID,
  provider_param  TEXT,
  match_count     INT DEFAULT 5,
  topic_id_param  UUID DEFAULT NULL
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
    AND c.provider = provider_param
    AND 1 - (c.embedding <=> query_embedding) > 0.4
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- ─────────────────────────────────────────────
-- INDEX: vector similarity search (IVFFLAT)
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS rag_embedding_idx
  ON rag_documents USING ivfflat (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS query_cache_embedding_idx
  ON query_cache USING ivfflat (query_embedding vector_cosine_ops)
  WHERE query_embedding IS NOT NULL;

-- ─────────────────────────────────────────────
-- FUNCTION: match_documents (cosine similarity search for RAG)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),
  provider_param  TEXT,
  match_threshold FLOAT DEFAULT 0.4,
  match_count     INT DEFAULT 5
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
  WHERE rag_documents.provider = provider_param
    AND 1 - (rag_documents.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- ─────────────────────────────────────────────
-- FUNCTION: match_topic_files (topic-scoped semantic search)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_topic_files(
  query_embedding vector(1536),
  p_topic_id      UUID,
  match_threshold FLOAT DEFAULT 0.4,
  match_count     INT DEFAULT 3
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
    AND 1 - (uf.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- ─────────────────────────────────────────────
-- FUNCTION: match_query_cache (semantic response cache)
-- ─────────────────────────────────────────────
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
    AND query_cache.user_id IS NOT DISTINCT FROM user_id_param
    AND query_cache.topic_id IS NOT DISTINCT FROM topic_id_param
    AND 1 - (query_cache.query_embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- ─────────────────────────────────────────────
-- FUNCTION: auto-update updated_at timestamps
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER topics_updated_at
  BEFORE UPDATE ON topics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY (RLS)
-- ─────────────────────────────────────────────
ALTER TABLE users    ENABLE ROW LEVEL SECURITY;
ALTER TABLE topics   ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- NOTE: Backend uses service_role key which bypasses RLS.
-- These policies protect direct client access.

-- ─────────────────────────────────────────────
-- SEED: Default admin user (change password after deploy!)
-- password_hash below = bcrypt of 'Admin@1234'
-- ─────────────────────────────────────────────
INSERT INTO users (email, username, password_hash, role, total_tokens, per_query_limit, session_minutes)
VALUES (
  'admin@multiai.com',
  'admin',
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TiGMoNiF1tZGWtOUMpZ4TzJh3.Oy',
  'admin',
  9999999,
  9999,
  480
) ON CONFLICT (email) DO NOTHING;

-- ─────────────────────────────────────────────
-- ADD: locked_until for brute-force/admin lock persistence
-- ─────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
