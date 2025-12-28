import type { ContinuityPlanV1 } from "./ContinuityPlanV1";

export function assertContinuityReady(plan: ContinuityPlanV1): void {
  if (!plan.lastTestedAt || !plan.owner) {
    throw new Error("BCP_NOT_READY");
  }
}
