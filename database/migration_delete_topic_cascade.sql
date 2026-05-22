-- ============================================================
-- FILE: database/migration_delete_topic_cascade.sql
-- PURPOSE: Atomic topic deletion RPC — prevents orphaned records
-- Run in Supabase SQL Editor
-- ============================================================

-- First ensure rag_documents has a topic_id column (it's missing in the base schema)
ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES topics(id) ON DELETE SET NULL;

-- Also check other tables that might be missing the column
ALTER TABLE query_cache ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES topics(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION delete_topic_cascade(
  p_topic_id UUID,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify topic belongs to user
  IF NOT EXISTS (SELECT 1 FROM topics WHERE id = p_topic_id AND user_id = p_user_id) THEN
    RAISE EXCEPTION 'Topic not found or access denied';
  END IF;

  -- All deletes happen atomically within this transaction
  DELETE FROM rag_documents     WHERE topic_id = p_topic_id;
  DELETE FROM query_cache       WHERE topic_id = p_topic_id;
  DELETE FROM messages          WHERE topic_id = p_topic_id;
  DELETE FROM uploaded_files    WHERE topic_id = p_topic_id;  -- cascades to rag_chunks via FK
  DELETE FROM uploaded_files_rag WHERE topic_id = p_topic_id;
  DELETE FROM topics            WHERE id = p_topic_id AND user_id = p_user_id;
END;
$$;
