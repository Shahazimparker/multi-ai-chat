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
-- Safe to re-run, and safe to run after a failed attempt: every step is
-- guarded, so nothing here depends on how far a previous run got.
-- ============================================================

ALTER TABLE uploaded_files
  ADD COLUMN IF NOT EXISTS rag_record_id UUID;

-- Backfill on the pairing the old delete used. Newest match wins: names repeat
-- within a topic, and the most recent pairing is the best guess available now.
-- Rows this cannot resolve stay NULL and are handled by the application's
-- legacy path.
--
-- A correlated subquery in SET, not UPDATE ... FROM LATERAL: the UPDATE target
-- is not in scope for a LATERAL item, so referencing `f` from inside one is an
-- error (42P10, "invalid reference to FROM-clause entry"). SET takes a scalar
-- subquery that may correlate to the target, which is exactly what is needed.
UPDATE uploaded_files f
SET    rag_record_id = (
  SELECT r.id
  FROM   uploaded_files_rag r
  WHERE  r.user_id   = f.user_id
    AND  r.file_name = f.file_name
    -- IS NOT DISTINCT FROM, so NULL topic matches NULL topic. Plain `=` would
    -- leave exactly the unscoped rows unlinked — the ones this fix is for.
    AND  r.topic_id IS NOT DISTINCT FROM f.topic_id
  ORDER  BY r.created_at DESC
  LIMIT  1
)
WHERE f.rag_record_id IS NULL;

-- The constraint is added separately and only once: ADD CONSTRAINT has no
-- IF NOT EXISTS, so a re-run would error without this guard. Rows the backfill
-- could not resolve stay NULL, and NULL never violates a foreign key.
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
