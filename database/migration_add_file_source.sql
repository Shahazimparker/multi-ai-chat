-- ============================================================
-- FILE: database/migration_add_file_source.sql
-- PURPOSE: Separate AI-generated files from user attachments.
--
-- uploaded_files_rag has always held both: documents the user
-- attached to a message and files a model produced. Nothing in
-- the row said which, so the sidebar "Artifacts" list showed
-- both. `source` makes the distinction explicit:
--   'generated' → produced by the AI (sidebar Artifacts)
--   'upload'    → attached or pasted by the user (chat Attachments panel)
--
-- Safe to re-run. The backend degrades gracefully while this is
-- unapplied — every file simply reads as 'upload'.
-- ============================================================

ALTER TABLE uploaded_files_rag
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'upload';

-- ── Backfill: messages.generated_files is the record of what the AI made ──
-- Each entry is {file_id, file_name, file_type, created_at}; the file_id
-- points straight at the uploaded_files_rag row.
UPDATE uploaded_files_rag f
SET    source = 'generated'
FROM (
  SELECT DISTINCT (entry ->> 'file_id')::uuid AS file_id
  FROM   messages m,
         LATERAL jsonb_array_elements(
           CASE jsonb_typeof(m.generated_files)
             WHEN 'array'  THEN m.generated_files
             -- Older rows double-encoded the column: a JSON string holding an array.
             WHEN 'string' THEN (m.generated_files #>> '{}')::jsonb
             ELSE '[]'::jsonb
           END
         ) AS entry
  WHERE  m.generated_files IS NOT NULL
    AND  (entry ->> 'file_id') ~ '^[0-9a-fA-F-]{36}$'
) g
WHERE f.id = g.file_id
  AND f.source <> 'generated';

-- Files whose type only a generator ever writes. Covers generated rows that
-- predate messages.generated_files, or that were saved without a message id.
UPDATE uploaded_files_rag
SET    source = 'generated'
WHERE  source <> 'generated'
  AND  file_type = 'generated';

-- The two list queries are "this user's files of this source, newest first".
CREATE INDEX IF NOT EXISTS idx_uploaded_files_rag_user_source_created
  ON uploaded_files_rag (user_id, source, created_at DESC);
