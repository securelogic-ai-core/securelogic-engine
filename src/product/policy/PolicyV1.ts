export interface PolicyV1 {
  version: "policy-v1";
  policyId: string;
  description: string;
  rules: PolicyRuleV1[];
  enforcedAt: string;
}

export interface PolicyRuleV1 {
  ruleId: string;
  type:
    | "MAX_ATTESTATIONS"
    | "REQUIRE_SIGNATURE"
    | "ALLOW_CONSUMER"
    | "DENY_CONSUMER"
    | "REQUIRE_TRUST_LEVEL";
  value: unknown;
}
