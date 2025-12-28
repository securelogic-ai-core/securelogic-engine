import { db } from "./client";
import crypto from "crypto";

export function writeAudit(envelopeId: string, valid: boolean) {
  db.prepare(
    "INSERT INTO audit_logs VALUES (?, ?, ?, ?)"
  ).run(
    crypto.randomUUID(),
    envelopeId,
    new Date().toISOString(),
    valid ? 1 : 0
  );
}
