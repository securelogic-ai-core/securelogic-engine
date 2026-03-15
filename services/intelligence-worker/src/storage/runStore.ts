import { db } from "./db";

export function startRun() {
  const stmt = db.prepare(`
    INSERT INTO worker_runs (started_at, status)
    VALUES (?, ?)
  `);

  const result = stmt.run(new Date().toISOString(), "running");
  return result.lastInsertRowid;
}

export function completeRun(id: number, signals: number, insights: number) {
  const stmt = db.prepare(`
    UPDATE worker_runs
    SET completed_at=?, status=?, signals_fetched=?, insights_generated=?
    WHERE id=?
  `);

  stmt.run(new Date().toISOString(), "success", signals, insights, id);
}

export function failRun(id: number, error: string) {
  const stmt = db.prepare(`
    UPDATE worker_runs
    SET completed_at=?, status=?, error_message=?
    WHERE id=?
  `);

  stmt.run(new Date().toISOString(), "failed", error, id);
}
