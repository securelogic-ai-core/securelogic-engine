import Database from "better-sqlite3";

export class SqliteDatabase {
  private static db: Database.Database;

  static open(path: string) {
    if (!this.db) {
      this.db = new Database(path);
      this.db.pragma("journal_mode = WAL");
    }
    return this.db;
  }
}
