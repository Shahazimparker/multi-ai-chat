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
  hit_count       INTEGER DEFAULT 1,      -- how many times this was served from cache
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
  embedding   vector(768),              -- text-embedding-004 dimension
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- INDEX: vector similarity search (HNSW)
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS rag_embedding_idx
  ON rag_documents USING hnsw (embedding vector_cosine_ops);

-- ─────────────────────────────────────────────
-- FUNCTION: match_documents (cosine similarity search for RAG)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(768),
  match_threshold FLOAT DEFAULT 0.7,
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
  WHERE 1 - (rag_documents.embedding <=> query_embedding) > match_threshold
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
