CREATE TABLE api_keys (
  key TEXT PRIMARY KEY,
  tier TEXT NOT NULL,
  revoked INTEGER DEFAULT 0
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  envelope_id TEXT,
  verified_at TEXT,
  valid INTEGER
);
