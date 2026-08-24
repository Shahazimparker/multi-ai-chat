-- ============================================================
-- Migration: Add blob_url column for Vercel Blob private storage
-- ============================================================

ALTER TABLE uploaded_files_rag ADD COLUMN IF NOT EXISTS blob_url TEXT;
ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS blob_url TEXT;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS blob_url TEXT;

CREATE INDEX IF NOT EXISTS idx_uploaded_files_rag_blob_url ON uploaded_files_rag(blob_url) WHERE blob_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_blob_url ON knowledge_documents(blob_url) WHERE blob_url IS NOT NULL;
