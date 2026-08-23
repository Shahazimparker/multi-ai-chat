-- ─────────────────────────────────────────────
-- MIGRATION: human_approvals.user_id
-- ─────────────────────────────────────────────
-- human_approvals had no owner column at all — any authenticated user could
-- approve, reject, or read the full context (tool arguments, user data) of
-- ANY pending request just by guessing/observing its id. This closes that
-- IDOR hole by attributing each row to the user whose chat turn created it.
--
-- Nullable on purpose: existing rows predate this column and cannot be
-- retroactively attributed to anyone. The application treats a NULL user_id
-- as "owned by nobody" (deny non-admin access) rather than "owned by
-- everybody" — see canAccessApproval() in approval.controller.js.
-- ─────────────────────────────────────────────

BEGIN;

ALTER TABLE human_approvals
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_human_approvals_user_id
  ON human_approvals (user_id);

COMMENT ON COLUMN human_approvals.user_id IS
  'Owning user, set at request creation. NULL on legacy rows = owned by nobody, not by everybody.';

COMMIT;

-- Verification — expects one row: user_id | uuid | YES
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'human_approvals' AND column_name = 'user_id';
