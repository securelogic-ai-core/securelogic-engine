import type { ExecutionRecord } from "./ExecutionRecord.js";
import { canonicalHash } from "./canonicalHash.js";

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
  const recomputedPayloadHash = canonicalHash(execution.payload);
  if (recomputedPayloadHash !== execution.payloadHash) {
    return false;
  }

  // ---- CHAIN VERIFICATION ----
  if (previous) {
    if (typeof execution.previousHash !== "string") return false;

    const prevHash = canonicalHash(previous);
    if (execution.previousHash !== prevHash) {
      return false;
    }
  }

  // ---- SIGNATURE CHECK (CRYPTO COMES IN PHASE 3) ----
  return true;
}
