-- ============================================================
-- FILE: database/migration_delete_user_cascade.sql
-- PURPOSE: Atomic, complete user deletion (GDPR / admin delete).
--
--   The previous application-side deleteUser() issued 8 sequential DELETEs,
--   none of them checking their own error, and it missed user_memories,
--   message_embeddings, knowledge_*, query_analytics, chat_jobs, file_rag,
--   rag_documents (topic-scoped) and human_approvals. A failure halfway left
--   an inconsistent, partially-deleted user.
--
--   This single SECURITY DEFINER function runs all deletes in ONE transaction,
--   so it is all-or-nothing. It also strips the failed-login counters keyed by
--   the user's identifier text (login_attempt_counters has no user_id column).
--
-- PREREQUISITES (run these migrations first):
--   migration_add_message_embeddings.sql
--   migration_add_rag2_knowledge_management.sql
--   migration_add_knowledge_graph.sql
--   migration_add_human_approvals.sql  +  migration_add_approval_user_scope.sql
--   migration_add_rate_limiting.sql
--   migration_delete_topic_cascade.sql  (adds rag_documents.topic_id)
--
-- IDEMPOTENT: safe to re-run (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION delete_user_cascade(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email    TEXT;
  v_username TEXT;
BEGIN
  -- Resolve identifier text for login_attempt_counters cleanup, and verify the
  -- user actually exists before touching any related table.
  SELECT email, username INTO v_email, v_username
    FROM users WHERE id = p_user_id;
  IF v_email IS NULL AND v_username IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- ── Knowledge graph (RAG 2.0) ─────────────────────────────
  -- Explicit, dependency-ordered deletes rather than relying on the cascade
  -- chain, so the intent is visible and safe against FK ordering surprises.
  DELETE FROM knowledge_relations
    WHERE collection_id IN (SELECT id FROM knowledge_collections WHERE user_id = p_user_id);
  DELETE FROM knowledge_entity_chunks
    WHERE entity_id IN (SELECT id FROM knowledge_entities
                          WHERE collection_id IN (SELECT id FROM knowledge_collections WHERE user_id = p_user_id))
       OR chunk_id  IN (SELECT id FROM knowledge_chunks
                          WHERE collection_id IN (SELECT id FROM knowledge_collections WHERE user_id = p_user_id));
  DELETE FROM knowledge_entities
    WHERE collection_id IN (SELECT id FROM knowledge_collections WHERE user_id = p_user_id);
  DELETE FROM knowledge_chunks
    WHERE collection_id IN (SELECT id FROM knowledge_collections WHERE user_id = p_user_id)
       OR document_id   IN (SELECT id FROM knowledge_documents WHERE user_id = p_user_id);
  DELETE FROM knowledge_documents WHERE user_id = p_user_id;
  DELETE FROM topic_knowledge_collections
    WHERE collection_id IN (SELECT id FROM knowledge_collections WHERE user_id = p_user_id)
       OR topic_id      IN (SELECT id FROM topics WHERE user_id = p_user_id);
  DELETE FROM knowledge_collections WHERE user_id = p_user_id;

  -- ── Cross-chat memory embeddings ──────────────────────────
  DELETE FROM message_embeddings WHERE user_id = p_user_id;

  -- ── Human-in-the-loop approvals ───────────────────────────
  DELETE FROM human_approvals WHERE user_id = p_user_id;

  -- ── Upload / code / memory artifacts ──────────────────────
  DELETE FROM rag_chunks WHERE file_id IN (SELECT id FROM uploaded_files WHERE user_id = p_user_id);
  DELETE FROM uploaded_files WHERE user_id = p_user_id;
  DELETE FROM uploaded_files_rag WHERE user_id = p_user_id;

  -- rag_documents is topic-scoped only (no user_id column).
  DELETE FROM rag_documents WHERE topic_id IN (SELECT id FROM topics WHERE user_id = p_user_id);

  -- user_id on these is ON DELETE SET NULL, so an explicit delete is the only
  -- way to actually remove the rows (not just orphan them).
  DELETE FROM query_cache WHERE user_id = p_user_id;
  DELETE FROM query_analytics WHERE user_id = p_user_id;

  -- ── Messages and topics ───────────────────────────────────
  DELETE FROM messages
    WHERE user_id = p_user_id
       OR topic_id IN (SELECT id FROM topics WHERE user_id = p_user_id);
  DELETE FROM topics WHERE user_id = p_user_id;

  -- ── Live-DB-only tables (guarded: absent from a fresh schema.sql) ──
  IF to_regclass('public.chat_jobs') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.chat_jobs WHERE user_id = $1' USING p_user_id;
  END IF;
  IF to_regclass('public.code_files') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.code_files WHERE user_id = $1' USING p_user_id;
  END IF;
  IF to_regclass('public.file_rag') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.file_rag WHERE user_id = $1' USING p_user_id;
  END IF;
  IF to_regclass('public.user_memories') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.user_memories WHERE user_id = $1' USING p_user_id;
  END IF;

  -- ── Failed-login counters (keyed by identifier text) ──────
  IF v_email IS NOT NULL THEN
    DELETE FROM login_attempt_counters WHERE identifier = lower(v_email);
  END IF;
  IF v_username IS NOT NULL THEN
    DELETE FROM login_attempt_counters WHERE identifier = lower(v_username);
  END IF;

  DELETE FROM users WHERE id = p_user_id;
END;
$$;

-- This is a destructive, admin-only operation. Default PUBLIC execute would let
-- anyone holding the anon/authenticated PostgREST key delete any user. The
-- backend calls it with the service_role key, which bypasses RLS and is granted
-- below — everyone else is locked out.
REVOKE EXECUTE ON FUNCTION delete_user_cascade(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION delete_user_cascade(UUID) TO service_role;

-- ─────────────────────────────────────────────
-- VERIFY (run separately)
-- ─────────────────────────────────────────────
-- SELECT delete_user_cascade('<user-uuid>');
