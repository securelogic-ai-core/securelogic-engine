import type { PolicyRuleV1 } from "./PolicyRuleV1";

export interface PolicySetV1 {
  version: "policy-set-v1";
  name: string;
  rules: PolicyRuleV1[];
}
