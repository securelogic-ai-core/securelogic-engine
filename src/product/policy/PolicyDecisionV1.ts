export type PolicyEffect = "ALLOW" | "DENY";

export interface PolicyDecisionV1 {
  version: "policy-decision-v1";
  effect: PolicyEffect;
  reason?: string;
}
