import type { AuditSprintResultV1 } from "../contracts/result";
import { hashResult } from "../integrity/hashResult";
import { validateAuditSprintResult } from "../validation/validateAuditSprintResult";

/**
 * AuditSprintResultFactory
 * SINGLE EXIT POINT — VALIDATED & IMMUTABLE
 */
export function finalizeAuditSprintResult(
  result: Omit<AuditSprintResultV1, "integrity">
): Readonly<AuditSprintResultV1> {
  const integrity = hashResult(result);

  const finalized: AuditSprintResultV1 = {
    ...result,
    integrity
  };

  validateAuditSprintResult(finalized);

  return deepFreeze(finalized);
}

function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj && typeof obj === "object") {
    Object.freeze(obj);
    Object.values(obj).forEach(value => {
      if (value && typeof value === "object" && !Object.isFrozen(value)) {
        deepFreeze(value);
      }
    });
  }
  return obj;
}
