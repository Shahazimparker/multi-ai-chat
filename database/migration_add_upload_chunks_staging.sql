-- Migration: Add upload_chunks_staging table for multi-part serverless uploads
-- Allows chunked uploads (e.g. 3MB slices) to bypass Vercel 4.5MB edge limits for direct DB mode (upgDB)

CREATE TABLE IF NOT EXISTS upload_chunks_staging (
  upload_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  total_chunks INT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  chunk_data TEXT NOT NULL, -- Base64 encoded chunk slice
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (upload_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_upload_chunks_staging_user ON upload_chunks_staging(user_id, upload_id);

-- Auto-cleanup function for expired staging chunks older than 2 hours
CREATE OR REPLACE FUNCTION cleanup_expired_upload_chunks()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM upload_chunks_staging WHERE created_at < NOW() - INTERVAL '2 hours';
END;
$$;
