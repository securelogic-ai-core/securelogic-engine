import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dbPath = path.join(process.cwd(), "services/intelligence-worker/data/intelligence.db");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS worker_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT,
  completed_at TEXT,
  status TEXT,
  signals_fetched INTEGER,
  insights_generated INTEGER,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT,
  title TEXT,
  url TEXT UNIQUE,
  published_at TEXT,
  normalized_score REAL,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signal_id INTEGER,
  insight TEXT,
  risk_score REAL,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS newsletter_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  content_md TEXT,
  content_html TEXT,
  status TEXT,
  created_at TEXT
);
`);
