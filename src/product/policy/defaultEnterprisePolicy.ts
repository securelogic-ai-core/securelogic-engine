import type { PolicyRuleV1 } from "./PolicyRuleV1";

export const DEFAULT_ENTERPRISE_POLICY: PolicyRuleV1[] = [
  {
    id: "trust-minimum",
    description: "Minimum trust level required",
    condition: (ctx) => ctx.trustLevel < 50,
    effect: "DENY"
  },
  {
    id: "require-attestations",
    description: "At least one attestation required",
    condition: (ctx) => ctx.attestationCount < 1,
    effect: "DENY"
  }
];
