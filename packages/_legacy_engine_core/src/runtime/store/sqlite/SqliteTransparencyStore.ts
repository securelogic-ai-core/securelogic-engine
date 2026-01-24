import { SqliteDatabase } from "./SqliteDatabase";
import type { TransparencyStore } from "../TransparencyStore";
import type { TransparencyEntry } from "../../transparency/TransparencyChain";

export class SqliteTransparencyStore implements TransparencyStore {
  private db;

  constructor(dbPath: string) {
    this.db = SqliteDatabase.open(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transparency (
        idx INTEGER PRIMARY KEY AUTOINCREMENT,
        root TEXT NOT NULL,
        run_hash TEXT NOT NULL,
        previous_root TEXT
      );
    `);
  }

  async append(entry: TransparencyEntry) {
    const stmt = this.db.prepare(
      "INSERT INTO transparency (root, run_hash, previous_root) VALUES (?, ?, ?)"
    );
    stmt.run(entry.root, entry.runHash, entry.previousRoot);
  }

  async getLatest(): Promise<TransparencyEntry | null> {
    const row = this.db
      .prepare("SELECT root, run_hash, previous_root FROM transparency ORDER BY idx DESC LIMIT 1")
      .get();

    if (!row) return null;

    return {
      root: row.root,
      runHash: row.run_hash,
      previousRoot: row.previous_root
    };
  }

  async getAll(): Promise<TransparencyEntry[]> {
    const rows = this.db
      .prepare("SELECT root, run_hash, previous_root FROM transparency ORDER BY idx ASC")
      .all();

    return rows.map((r: any) => ({
      root: r.root,
      runHash: r.run_hash,
      previousRoot: r.previous_root
    }));
  }
}
