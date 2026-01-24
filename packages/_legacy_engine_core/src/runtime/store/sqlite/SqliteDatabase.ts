import Database from "better-sqlite3";

export class SqliteDatabase {
  static open(path: string) {
    const db = new Database(path || "engine.db");

    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = FULL");
    db.pragma("foreign_keys = ON");

    return db;
  }
}
