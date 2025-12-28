import type { LegalHoldV1 } from "./LegalHoldV1";

export function assertLegalHold(activeHolds: LegalHoldV1[]): void {
  if (activeHolds.length > 0) {
    throw new Error("LEGAL_HOLD_ACTIVE");
  }
}
