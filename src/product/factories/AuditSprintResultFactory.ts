import type { AuditSprintResultV1 } from "../contracts/result";
import { hashResult } from "../integrity/hashResult";

/**
 * AuditSprintResultFactory
 * ------------------------
 * SINGLE EXIT POINT for client-facing results.
 */
export function finalizeAuditSprintResult(
  result: Omit<AuditSprintResultV1, "integrity">
): Readonly<AuditSprintResultV1> {
  const integrity = hashResult(result);

  const finalized: AuditSprintResultV1 = {
    ...result,
    integrity
  };

  return deepFreeze(finalized);
}

/* Deep freeze for immutability */
function deepFreeze<T>(obj: T): Readonly<T> {
  Object.freeze(obj);
  Object.getOwnPropertyNames(obj).forEach(prop => {
    const value = (obj as any)[prop];
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  });
  return obj;
}
