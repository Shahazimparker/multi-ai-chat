CREATE TABLE IF NOT EXISTS human_approvals (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'approval',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  response JSONB,
  reason TEXT,
  approver TEXT,
  required_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_human_approvals_status_created
  ON human_approvals (status, created_at DESC);
