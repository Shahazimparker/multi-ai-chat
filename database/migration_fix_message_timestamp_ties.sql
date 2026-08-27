-- ============================================================
-- FILE: database/migration_fix_message_timestamp_ties.sql
-- PURPOSE: Repair conversation turns whose user and assistant rows share an
--          identical created_at, and stop new ones being written that way.
--
--   chatPipeline saved both rows of a turn in ONE insert and left created_at to
--   the column default. Postgres now() is transaction-scoped, so both rows got
--   the identical timestamp. Observed live: 20 messages across 10 distinct
--   timestamps — every single turn tied.
--
--   Two consequences, both silent:
--
--     1. ORDER BY created_at has a two-row tie per turn, which Postgres resolves
--        arbitrarily. History could come back with the assistant turn AHEAD of
--        the user turn that prompted it — the model reads an answer before its
--        question. Observed as role sequences like `...u a u a a u u a a u...`.
--
--     2. The resolution could differ between requests, so the same conversation
--        produced a different prompt each time. That changes the prompt prefix
--        and destroys the provider prompt cache, which keys on an exact prefix.
--
--   The code fix (explicit created_at, one millisecond apart) covers new rows.
--   This repairs the existing ones: within a tied pair the user message is by
--   definition the earlier of the two, so nudging the assistant row forward by
--   one millisecond recovers the true order rather than merely a stable one.
--
-- PREREQUISITES: schema.sql.
-- IDEMPOTENT: safe to re-run — after the first pass no ties remain, so the
--             UPDATE matches nothing.
-- SAFE: touches only created_at, only on rows that are actually tied, and only
--       the assistant side of the pair.
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. Inspect before changing anything (run on its own first)
-- ─────────────────────────────────────────────
-- SELECT topic_id,
--        created_at,
--        COUNT(*)                                   AS rows_sharing_timestamp,
--        STRING_AGG(role, ',' ORDER BY role)        AS roles
--   FROM messages
--  WHERE is_summary = false
--  GROUP BY topic_id, created_at
-- HAVING COUNT(*) > 1
--  ORDER BY created_at DESC
--  LIMIT 50;

-- ─────────────────────────────────────────────
-- 2. Repair: push the assistant row 1ms past its user row
-- ─────────────────────────────────────────────
-- Restricted to exact user/assistant pairs. A timestamp shared by three or more
-- rows, or by two rows of the same role, is not a turn and is left alone rather
-- than guessed at.
WITH tied AS (
  SELECT topic_id, created_at
    FROM messages
   WHERE is_summary = false
   GROUP BY topic_id, created_at
  HAVING COUNT(*) = 2
     AND COUNT(*) FILTER (WHERE role = 'user')      = 1
     AND COUNT(*) FILTER (WHERE role = 'assistant') = 1
)
UPDATE messages m
   SET created_at = m.created_at + INTERVAL '1 millisecond'
  FROM tied t
 WHERE m.topic_id   = t.topic_id
   AND m.created_at = t.created_at
   AND m.role       = 'assistant'
   AND m.is_summary = false;

-- ─────────────────────────────────────────────
-- VERIFY (run separately — expect 0 rows)
-- ─────────────────────────────────────────────
-- SELECT topic_id, created_at, COUNT(*)
--   FROM messages
--  WHERE is_summary = false
--  GROUP BY topic_id, created_at
-- HAVING COUNT(*) > 1;
--
-- And spot-check that turns now alternate cleanly:
-- SELECT role, created_at
--   FROM messages
--  WHERE topic_id = '<a topic id>' AND is_summary = false
--  ORDER BY created_at;
