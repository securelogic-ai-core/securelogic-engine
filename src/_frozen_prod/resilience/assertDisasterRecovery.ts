import type { DisasterRecoveryPlanV1 } from "./DisasterRecoveryPlanV1";

export function assertDisasterRecovery(p: DisasterRecoveryPlanV1): void {
  if (!p.multiRegion || p.rpoMinutes <= 0 || p.rtoMinutes <= 0) {
    throw new Error("DR_POLICY_VIOLATION");
  }
}
