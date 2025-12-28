import type { PolicyDecisionV1 } from "./PolicyDecisionV1";

export function enforcePolicy(decision: PolicyDecisionV1): void {
  if (decision.effect !== "ALLOW") {
    throw new Error(`POLICY_DENIED:${decision.reason ?? "unspecified"}`);
  }
}
