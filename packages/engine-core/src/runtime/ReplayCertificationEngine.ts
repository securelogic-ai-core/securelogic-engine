import type { ExecutionRecord } from "./ExecutionRecord.js";
import crypto from "crypto";

export function certifyExecution(
  execution: ExecutionRecord,
  previous: ExecutionRecord | null
): boolean {

  // ---- HARD SHAPE VALIDATION ----
  if (!execution || typeof execution !== "object") return false;
  if (!execution.payload || typeof execution.payload !== "object") return false;
  if (typeof execution.payloadHash !== "string") return false;
  if (typeof execution.policyBundleHash !== "string") return false;
  if (!Array.isArray(execution.signatures) || execution.signatures.length === 0) return false;

  // ---- PAYLOAD HASH VERIFICATION ----
  const payloadJson = JSON.stringify(execution.payload);
  const recomputedPayloadHash = crypto
    .createHash("sha256")
    .update(payloadJson)
    .digest("hex");

  if (recomputedPayloadHash !== execution.payloadHash) {
    return false;
  }

  // ---- CHAIN VERIFICATION ----
  if (previous) {
    if (typeof execution.previousHash !== "string") return false;

    const prevJson = JSON.stringify(previous);
    const prevHash = crypto.createHash("sha256").update(prevJson).digest("hex");

    if (execution.previousHash !== prevHash) {
      return false;
    }
  }

  // ---- SIGNATURE PRESENCE CHECK (CRYPTO COMES NEXT PHASE) ----
  return true;
}
