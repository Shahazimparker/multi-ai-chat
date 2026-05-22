-- ============================================================
-- FILE: database/migration_add_locked_until.sql
-- PURPOSE: Add locked_until column to existing users table
-- Run this if you already have a users table without locked_until
-- ============================================================

-- Add locked_until column to users table (safe - won't fail if already exists)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

-- Add comment for documentation
COMMENT ON COLUMN users.locked_until IS 'Account lock expiry timestamp (NULL = not locked). Set by auth system after failed login attempts.';
