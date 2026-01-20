import { SqliteDatabase } from "./SqliteDatabase";
import type { TransparencyStore } from "../TransparencyStore";
import type { TransparencyEntry } from "../../transparency/TransparencyChain";

export class SqliteTransparencyStore implements TransparencyStore {
  constructor(dbPath: string) {
    const db = SqliteDatabase.open(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS transparency (
        idx INTEGER PRIMARY KEY AUTOINCREMENT,
        root TEXT NOT NULL,
        run_hash TEXT NOT NULL,
        previous_root TEXT
      );
    `);
  }

  async getLatest(): Promise<TransparencyEntry | null> {
    const db = SqliteDatabase.open("");
    const row = db.prepare("SELECT * FROM transparency ORDER BY idx DESC LIMIT 1").get();
    return row ?? null;
  }

  async append(entry: TransparencyEntry) {
    const db = SqliteDatabase.open("");
    const stmt = db.prepare(`
      INSERT INTO transparency (root, run_hash, previous_root)
      VALUES (?, ?, ?)
    `);
    stmt.run(entry.root, entry.runHash, entry.previousRoot);
  }
}
