-- ─────────────────────────────────────────────
-- MIGRATION: store the model's chain of thought
-- ─────────────────────────────────────────────
-- Reasoning models (DeepSeek thinking mode, Claude extended thinking) return
-- their thought process in a field separate from the answer. The app streams it
-- to the collapsible "Thought process" panel live; this column is what makes it
-- survive a page reload.
--
-- Optional. Until it is applied the app saves messages without reasoning and
-- logs a warning once per process — chat keeps working, the panel is just empty
-- on reloaded history.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS reasoning TEXT;
