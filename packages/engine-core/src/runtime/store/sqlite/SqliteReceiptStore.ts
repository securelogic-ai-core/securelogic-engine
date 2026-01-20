import { SqliteDatabase } from "./SqliteDatabase";
import type { ReceiptStore } from "../ReceiptStore";
import type { RunReceipt } from "../../receipt/RunReceipt";

export class SqliteReceiptStore implements ReceiptStore {
  constructor(dbPath: string) {
    const db = SqliteDatabase.open(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS receipts (
        run_id TEXT PRIMARY KEY,
        run_hash TEXT NOT NULL,
        transparency_root TEXT NOT NULL,
        signed_by TEXT NOT NULL,
        signature TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  async save(receipt: RunReceipt) {
    const db = SqliteDatabase.open("");
    const stmt = db.prepare(`
      INSERT INTO receipts (run_id, run_hash, transparency_root, signed_by, signature, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      receipt.runId,
      receipt.runHash,
      receipt.transparencyRoot,
      receipt.signedBy,
      receipt.signature,
      receipt.createdAt
    );
  }

  async get(runId: string) {
    const db = SqliteDatabase.open("");
    return db.prepare("SELECT * FROM receipts WHERE run_id = ?").get(runId) ?? null;
  }
}
