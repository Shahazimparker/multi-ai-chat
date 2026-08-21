-- ─────────────────────────────────────────────
-- MIGRATION: users.timezone
-- ─────────────────────────────────────────────
-- The browser reports an IANA zone on every chat request, but that is the zone
-- of the device in front of the user, not the zone their work happens in — a
-- consultant on a plane, a shared kiosk, or a laptop with the clock still set
-- to the last country all report the wrong answer confidently.
--
-- This column is the durable preference and outranks the browser-reported
-- value in backend/services/temporalContext.service.js -> resolveTimeZone().
-- NULL means "trust the browser", which is the right default: it is correct
-- for most users and needs no onboarding step.
--
-- Values are IANA names ('Asia/Kolkata', 'Europe/London'). The application
-- validates against Intl before use, so an unknown value degrades to the next
-- source in the chain rather than failing a request.
-- ─────────────────────────────────────────────

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS timezone TEXT;

COMMENT ON COLUMN users.timezone IS
  'IANA timezone name for temporal grounding of AI prompts. NULL = use the browser-reported zone.';

COMMIT;

-- Verification — expects one row: timezone | text | YES
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'users' AND column_name = 'timezone';
