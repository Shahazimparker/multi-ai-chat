-- ============================================================
-- MIGRATION: Add RAG-based cross-chat memory
-- Embeds every message for semantic search across all user chats
-- ============================================================

-- 1. Create message_embeddings table
CREATE TABLE IF NOT EXISTS message_embeddings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id        UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  embedding       vector(1536) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_msg_emb_user_id ON message_embeddings(user_id);
CREATE INDEX IF NOT EXISTS idx_msg_emb_topic_id ON message_embeddings(topic_id);
CREATE INDEX IF NOT EXISTS idx_msg_emb_message_id ON message_embeddings(message_id);
CREATE INDEX IF NOT EXISTS idx_msg_emb_created_at ON message_embeddings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_emb_embedding ON message_embeddings USING hnsw (embedding vector_cosine_ops);

-- 3. search_memory function: semantic search across all user messages
-- Excludes messages from the current topic (already in context)
-- Returns top-K similar past messages with their role and source topic
CREATE OR REPLACE FUNCTION search_memory(
  query_embedding vector(1536),
  p_user_id       UUID,
  p_exclude_topic UUID DEFAULT NULL,
  match_threshold FLOAT DEFAULT 0.5,
  match_count     INT DEFAULT 5
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
    AND 1 - (me.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- 4. Cleanup function: delete embeddings for deleted messages (trigger)
CREATE OR REPLACE FUNCTION cleanup_message_embedding()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM message_embeddings WHERE message_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_message_embedding ON messages;
CREATE TRIGGER trg_cleanup_message_embedding
  AFTER DELETE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_message_embedding();
