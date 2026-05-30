-- ============================================================
-- FILE: database/migration_add_generated_files_to_messages.sql
-- PURPOSE: Add generated_files JSONB column to messages table
-- so AI-generated file references (PPT, images, etc.) persist
-- and survive page refresh.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS generated_files JSONB DEFAULT '[]'::jsonb;
