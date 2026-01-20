CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  record_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS receipts (
  run_id TEXT PRIMARY KEY,
  run_hash TEXT NOT NULL,
  transparency_root TEXT NOT NULL,
  signed_by TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transparency (
  idx INTEGER PRIMARY KEY AUTOINCREMENT,
  root TEXT NOT NULL,
  run_hash TEXT NOT NULL,
  previous_root TEXT
);
