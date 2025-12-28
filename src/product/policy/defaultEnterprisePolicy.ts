import type { PolicySetV1 } from "./PolicySetV1";

export const DEFAULT_ENTERPRISE_POLICY: PolicySetV1 = {
  version: "policy-set-v1",
  name: "enterprise-default",
  rules: [
    {
      id: "require-trust",
      description: "Minimum trust score",
      condition: (ctx) => ctx.trustLevel < 50,
      effect: "DENY"
    },
    {
      id: "allow-standard",
      description: "Allow verified envelopes",
      condition: () => true,
      effect: "ALLOW"
    }
  ]
};
