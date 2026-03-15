import { db } from "./db";

export function saveSignal(signal: any) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO signals
    (source, title, url, published_at, normalized_score, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    signal.source,
    signal.title,
    signal.url,
    signal.publishedAt,
    signal.score || 0,
    new Date().toISOString()
  );
}

export function getSignals() {
  return db.prepare("SELECT * FROM signals ORDER BY created_at DESC").all();
}
