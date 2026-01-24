import { SqliteDatabase } from "./SqliteDatabase";
import type { RunStore } from "../RunStore";

export class SqliteRunStore implements RunStore {
  private db;

  constructor(dbPath: string) {
    this.db = SqliteDatabase.open(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        record_json TEXT NOT NULL
      );
    `);
  }

  async save(runId: string, recordJson: string) {
    const stmt = this.db.prepare(
      "INSERT OR IGNORE INTO runs (run_id, record_json) VALUES (?, ?)"
    );
    stmt.run(runId, recordJson);
  }

  async get(runId: string): Promise<string | null> {
    const row = this.db
      .prepare("SELECT record_json FROM runs WHERE run_id = ?")
      .get(runId);
    return row?.record_json ?? null;
  }
}
