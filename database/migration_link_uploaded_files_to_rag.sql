-- ============================================================
-- FILE: database/migration_link_uploaded_files_to_rag.sql
-- PURPOSE: Make deleting a file actually delete all of it.
--
-- A chunked upload writes THREE places:
--   uploaded_files_rag  — the row the UI lists and deletes
--   uploaded_files      — the parent of the searchable chunks
--   rag_chunks          — the embedded text RAG retrieves
--
-- Nothing linked the first to the second, so the delete matched them by
-- (user_id, topic_id, file_name). That missed rows with topic_id NULL — their
-- chunks survived the delete and stayed retrievable, so a "deleted" file could
-- still be fed to the model as context — and it over-matched when one topic
-- held two files of the same name, taking the chunks of the one being kept.
--
-- An explicit link fixes both, and ON DELETE CASCADE means the database
-- enforces it rather than the application remembering to.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE uploaded_files
  ADD COLUMN IF NOT EXISTS rag_record_id UUID;

-- Backfill on the pairing the old delete used. Newest match wins: names repeat
-- within a topic, and the most recent pairing is the best guess available now.
-- Rows this cannot resolve keep rag_record_id NULL and are handled by the
-- application's legacy path.
UPDATE uploaded_files f
SET    rag_record_id = r.id
FROM   LATERAL (
  SELECT r.id
  FROM   uploaded_files_rag r
  WHERE  r.user_id = f.user_id
    AND  r.file_name = f.file_name
    AND  (r.topic_id IS NOT DISTINCT FROM f.topic_id)
  ORDER  BY r.created_at DESC
  LIMIT  1
) r
WHERE f.rag_record_id IS NULL;

-- The constraint is added separately and only once: ADD CONSTRAINT has no
-- IF NOT EXISTS, so a re-run would error without this guard. NOT VALID skips
-- re-checking rows that already exist — the backfill above may legitimately
-- leave some NULL, and NULL never violates a foreign key anyway.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uploaded_files_rag_record_id_fkey'
  ) THEN
    ALTER TABLE uploaded_files
      ADD CONSTRAINT uploaded_files_rag_record_id_fkey
      FOREIGN KEY (rag_record_id) REFERENCES uploaded_files_rag(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_uploaded_files_rag_record_id
  ON uploaded_files (rag_record_id) WHERE rag_record_id IS NOT NULL;
