-- ============================================================
-- MIGRATION: drop the unused `sessions` table
-- ============================================================
-- The table was created for JWT session tracking (token_hash + expires_at)
-- but no application code ever read from or wrote to it, so it provided no
-- revocation guarantee while implying one.
--
-- Access control today is enforced in backend/middleware/auth.js, which
-- re-reads the users row on every authenticated request and rejects
-- is_active = false and past-dated expires_at. An admin disabling an account
-- therefore takes effect on that account's next request.
--
-- Trade-off accepted: JWTs stay stateless, so logout is client-side only and
-- an already-issued token remains valid until it expires. If per-token or
-- per-device revocation is needed later, reintroduce this table and add the
-- lookup to requireAuth — see git history for the original definition.
--
-- Safe to re-run.
-- ============================================================

DROP INDEX IF EXISTS idx_sessions_token_hash;
DROP INDEX IF EXISTS idx_sessions_expires_at;
DROP INDEX IF EXISTS idx_sessions_user_id;

DROP TABLE IF EXISTS sessions;
