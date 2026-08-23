-- ============================================================
-- FILE: database/migration_enable_rls_all_tables.sql
-- PURPOSE: Close the RLS gap left by tables created after schema.sql.
--
--   schema_export.sql (a dump of the live DB) shows every table carries
--   `GRANT ALL ... TO anon`, and a default-privileges rule that hands the
--   same grant to any *future* table automatically. RLS is the only thing
--   standing between that grant and the public PostgREST endpoint. schema.sql
--   enables it for the 13 tables it knows about, but nine tables added later
--   by migration_add_human_approvals.sql, migration_add_rag2_knowledge_management.sql,
--   migration_add_message_embeddings.sql and migration_add_knowledge_graph.sql
--   were never covered, leaving them readable and writable by anyone holding
--   the (publishable) anon key.
--
--   The backend connects with the service_role key, which bypasses RLS
--   entirely, so nothing here affects server-side queries. This only denies
--   *direct* PostgREST access from the anon/authenticated roles. No policies
--   are defined on purpose: RLS enabled with zero policies means those roles
--   can read and write nothing.
--
--   Guarded with to_regclass so this runs cleanly regardless of which of the
--   above migrations have been applied, and re-enables RLS on the original
--   13 tables too, plus `sessions` (present in the dump, dropped by
--   migration_drop_sessions.sql, covered here in case that has not been run).
--   That is every table any file under database/ can create, so this single
--   file is a complete "lock everything down" pass safe to re-run at any time.
-- IDEMPOTENT: safe to re-run.
-- ============================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    -- Already covered by schema.sql; re-enabled defensively.
    'users', 'topics', 'messages', 'query_cache', 'query_analytics',
    'rag_documents', 'uploaded_files', 'rag_chunks', 'uploaded_files_rag',
    'chat_jobs', 'code_files', 'file_rag', 'user_memories',
    -- Not created by schema.sql: it exists only in the live dump, where it
    -- carries GRANT ALL TO anon with no RLS. migration_drop_sessions.sql
    -- removes it, so this is a no-op once that has been applied — but whether
    -- it has been applied is not something this file can assume.
    'sessions',
    -- Added by later migrations, never had RLS enabled.
    'human_approvals',
    'knowledge_collections', 'knowledge_documents', 'knowledge_chunks',
    'topic_knowledge_collections', 'message_embeddings',
    'knowledge_entities', 'knowledge_entity_chunks', 'knowledge_relations'
  ]
  LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- Without this, any table created after today inherits GRANT ALL TO anon
-- the moment it's created, silently reopening this same gap.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;

-- ─────────────────────────────────────────────
-- VERIFY (run separately) — every row should show rowsecurity = t
-- ─────────────────────────────────────────────
-- SELECT relname, relrowsecurity
-- FROM pg_class
-- WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
-- ORDER BY relname;
