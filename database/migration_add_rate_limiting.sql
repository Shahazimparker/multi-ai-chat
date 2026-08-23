-- ============================================================
-- FILE: database/migration_add_rate_limiting.sql
-- PURPOSE: Shared Postgres state for rate limiting and login lockout.
--
--   The app runs on Vercel serverless: every lambda instance has its own
--   memory, instances are created/destroyed constantly, and several of them
--   can be alive concurrently. express-rate-limit's default MemoryStore and
--   the old in-memory failed-login counter both lived in that per-instance
--   memory, so an attacker got a fresh budget on every cold instance and a
--   multiplied one across concurrent instances. Redis would be the usual
--   fix, but this project deliberately stays on Postgres/Supabase (already
--   provisioned, no new infra to run or pay for) rather than adding Redis
--   just for counters.
--
-- IDEMPOTENT: safe to re-run.
-- ============================================================

-- ── Rate limit counters ─────────────────────────────────────
-- One row per (limiter, key) — e.g. "chat:1.2.3.4" or "upload-heavy:<userId>".
-- `key` alone is the primary key: every limiter shares this one table, so the
-- namespace prefix is mandatory and is enforced in code by
-- SupabaseRateLimitStore's constructor (rateLimitStore.service.js), not left to
-- each call site to remember. It doubles as the natural index for the
-- read-modify-write below.
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  key          TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  hit_count    INTEGER     NOT NULL DEFAULT 1,
  expires_at   TIMESTAMPTZ NOT NULL
);

-- Supports the periodic sweep below (and any future cron-based one) picking
-- expired rows without a seq scan across every key the app has ever seen.
CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_expires_at
  ON rate_limit_counters (expires_at);

ALTER TABLE rate_limit_counters ENABLE ROW LEVEL SECURITY;

-- ── Login attempt counters ──────────────────────────────────
-- users.locked_until (migration_add_locked_until.sql) already holds the lock
-- itself for a resolved account. What was missing is durable *counting* for
-- identifiers typed at the login form, which may not match any real user —
-- a per-process Map can't survive across instances, and there's no users row
-- to persist a count on when the identifier doesn't resolve to one. Keyed on
-- the identifier text (lowercased) rather than a user id for exactly that
-- reason: a nonexistent username still needs to accumulate failures so a
-- caller can't distinguish "real account, never locked" from "fake account"
-- by noticing only one of them ever locks.
CREATE TABLE IF NOT EXISTS login_attempt_counters (
  identifier   TEXT PRIMARY KEY,
  fail_count   INTEGER     NOT NULL DEFAULT 1,
  last_fail_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ
);

ALTER TABLE login_attempt_counters ENABLE ROW LEVEL SECURITY;

-- ── rate_limit_increment — atomic increment-and-check ───────
-- express-rate-limit calls this once per request. A plain read-then-write
-- from Node races badly under concurrency (two requests in the same window
-- can both read hit_count=4 and both write back 5, undercounting); a single
-- INSERT ... ON CONFLICT ... RETURNING does the read, the fixed-window reset
-- check, and the write in one round trip and one row lock.
CREATE OR REPLACE FUNCTION rate_limit_increment(
  p_key       TEXT,
  p_window_ms BIGINT
)
RETURNS TABLE(hit_count INTEGER, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Opportunistic cleanup instead of a scheduled job (no cron infra here):
  -- cheap, self-limiting, and keeps the table bounded without depending on
  -- anything external ever getting configured to call rate_limit_cleanup_expired().
  -- Column references are table-qualified on purpose: RETURNS TABLE(hit_count,
  -- expires_at) declares those names as OUT *variables* inside this plpgsql
  -- body, so a bare `expires_at` here matches both a column and a variable and
  -- Postgres raises 'column reference is ambiguous' (the default
  -- plpgsql.variable_conflict is 'error'). It would only fire on the 1% of
  -- calls that run this DELETE, aborting the whole increment intermittently.
  IF random() < 0.01 THEN
    DELETE FROM rate_limit_counters
    WHERE rate_limit_counters.expires_at < now() - interval '1 hour';
  END IF;

  RETURN QUERY
  INSERT INTO rate_limit_counters AS rlc (key, window_start, hit_count, expires_at)
  VALUES (p_key, now(), 1, now() + (p_window_ms || ' milliseconds')::interval)
  ON CONFLICT (key) DO UPDATE SET
    -- Fixed window: once expires_at has passed, the old window is dead, so
    -- this hit starts a new one instead of piling onto a stale count.
    hit_count    = CASE WHEN rlc.expires_at <= now() THEN 1 ELSE rlc.hit_count + 1 END,
    window_start = CASE WHEN rlc.expires_at <= now() THEN now() ELSE rlc.window_start END,
    expires_at   = CASE WHEN rlc.expires_at <= now() THEN now() + (p_window_ms || ' milliseconds')::interval ELSE rlc.expires_at END
  RETURNING rlc.hit_count, rlc.expires_at;
END;
$$;

-- ── rate_limit_decrement — best-effort, for skipFailedRequests-style opts ──
-- None of the limiters in this app currently set skipFailedRequests /
-- skipSuccessfulRequests, but the express-rate-limit Store interface
-- requires the method to exist. A lost decrement under concurrency just
-- makes the window very slightly stricter, so this doesn't need the same
-- atomic-RPC treatment as increment.
CREATE OR REPLACE FUNCTION rate_limit_decrement(
  p_key TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE rate_limit_counters SET hit_count = GREATEST(hit_count - 1, 0) WHERE key = p_key;
$$;

-- Manual/optional: not wired to a scheduler (none exists in this project),
-- but available for one if it's ever added. rate_limit_increment's own
-- opportunistic delete above is what actually keeps the table bounded today.
CREATE OR REPLACE FUNCTION rate_limit_cleanup_expired()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
AS $$
  DELETE FROM rate_limit_counters WHERE expires_at < now() - interval '1 hour';
$$;

-- ── record_login_failure — atomic increment-and-lock-check ──────────────
-- Mirrors rate_limit_increment's shape for the same concurrency reason, plus
-- the sliding-window-then-lock logic that used to live in auth.controller.js's
-- in-memory failMap. Only ever touches this table, keyed by the identifier
-- text the caller already validated — never a caller-supplied pattern. (See
-- the comment on recordFailedAttempt in auth.controller.js: a pattern-based
-- UPDATE here once let an unauthenticated caller lock every account at once.)
CREATE OR REPLACE FUNCTION record_login_failure(
  p_identifier TEXT,
  p_window_ms  BIGINT,
  p_max_fails  INTEGER,
  p_lock_ms    BIGINT
)
RETURNS TABLE(fail_count INTEGER, locked_until TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count  INTEGER;
  v_locked TIMESTAMPTZ;
BEGIN
  -- Opportunistic cleanup, same pattern as rate_limit_increment (no cron infra
  -- here). Thresholds are longer than rate_limit_counters' because a stale lock
  -- or a stale unlocked count is evidence worth keeping around a while, not a
  -- hot counter reused every request.
  -- Table-qualified for the same reason as rate_limit_increment's cleanup:
  -- RETURNS TABLE(fail_count, locked_until) makes `locked_until` an OUT variable
  -- in this body, so an unqualified reference is ambiguous and errors at runtime.
  IF random() < 0.01 THEN
    DELETE FROM login_attempt_counters lac
    WHERE (lac.locked_until IS NOT NULL AND lac.locked_until < now() - interval '1 hour')
       OR (lac.locked_until IS NULL AND lac.last_fail_at < now() - interval '1 day');
  END IF;

  INSERT INTO login_attempt_counters AS lac (identifier, fail_count, last_fail_at, locked_until)
  VALUES (p_identifier, 1, now(), NULL)
  ON CONFLICT (identifier) DO UPDATE SET
    fail_count = CASE
      -- A lock that has already expired means the penalty was served: start a
      -- fresh count. Without this branch the row's stale locked_until keeps
      -- fail_count pinned at or above p_max_fails forever, so the very next
      -- single failure re-trips the threshold — one typo after any past
      -- lockout would re-lock the account for the full p_lock_ms, permanently.
      -- (The row is only cleared on a *successful* login, and the opportunistic
      -- DELETE above is 1%-probabilistic, so nothing else reliably resets it.)
      WHEN lac.locked_until IS NOT NULL AND lac.locked_until <= now() THEN 1
      -- Sliding window, no lock in play: a gap wider than the window means the
      -- earlier failures no longer count.
      WHEN lac.locked_until IS NULL
           AND now() - lac.last_fail_at > (p_window_ms || ' milliseconds')::interval
      THEN 1
      -- Active lock (keep counting regardless of gap, so re-checking mid-lock
      -- can't quietly reset it), or a failure inside the window.
      ELSE lac.fail_count + 1
    END,
    -- Drop an expired lock so neither the CASE above nor checkAccountLock's
    -- read can mistake it for an active one on a later call.
    locked_until = CASE WHEN lac.locked_until > now() THEN lac.locked_until ELSE NULL END,
    last_fail_at = now()
  RETURNING lac.fail_count INTO v_count;

  -- Separate statement rather than folding into the SET above: the lock
  -- decision depends on the fail_count the UPDATE just computed, which
  -- plpgsql can't reference mid-statement without repeating the whole CASE.
  -- Both statements run inside this function's single transaction, and the
  -- ON CONFLICT DO UPDATE above holds the row lock for the identifier until it
  -- commits, so a concurrent call for the same identifier blocks and then
  -- re-reads the committed row — no lost increment, no interleaving.
  IF v_count >= p_max_fails THEN
    UPDATE login_attempt_counters
      SET locked_until = now() + (p_lock_ms || ' milliseconds')::interval
      WHERE identifier = p_identifier
      RETURNING login_attempt_counters.locked_until INTO v_locked;
  ELSE
    SELECT lac.locked_until INTO v_locked FROM login_attempt_counters lac WHERE lac.identifier = p_identifier;
  END IF;

  RETURN QUERY SELECT v_count, v_locked;
END;
$$;

-- ── Close the same anon-by-default gap RLS just closed, for functions ──
-- schema_export.sql shows this project's default privileges also grant ALL
-- ON FUNCTIONS to anon/authenticated at creation time (not just ALL ON
-- TABLES, which migration_enable_rls_all_tables.sql already addresses for
-- future tables). RLS on the tables above doesn't help here: these are
-- SECURITY DEFINER functions, so without this REVOKE, anon holding nothing
-- but the publishable key could call record_login_failure('victim@x.com', ...)
-- directly over PostgREST and lock out an arbitrary login identifier without
-- ever attempting to log in, or call rate_limit_increment with someone
-- else's key to burn their quota. service_role (what the backend uses) is
-- unaffected — it's granted separately, not through PUBLIC/anon.
REVOKE EXECUTE ON FUNCTION rate_limit_increment(TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION rate_limit_decrement(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION rate_limit_cleanup_expired() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION record_login_failure(TEXT, BIGINT, INTEGER, BIGINT) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────
-- VERIFY (run separately)
-- ─────────────────────────────────────────────
-- SELECT relname, relrowsecurity FROM pg_class
-- WHERE relnamespace = 'public'::regnamespace
--   AND relname IN ('rate_limit_counters', 'login_attempt_counters');
--
-- SELECT * FROM rate_limit_increment('chat:1.2.3.4', 60000);
-- SELECT * FROM record_login_failure('nobody@example.com', 900000, 5, 900000);
