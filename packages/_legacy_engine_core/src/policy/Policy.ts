import type { RiskContext } from "../context/RiskContext.js";
import type { Finding } from "../findings/Finding.js";

export type PolicyEffect = "ALLOW" | "DENY" | "REQUIRE_REVIEW";

export type Policy = {
  policyId: string;
  name: string;
  description: string;

  appliesTo: RiskContext["subjectType"][];

  evaluate: (input: {
    context: RiskContext;
    findings: Finding[];
  }) => {
    effect: PolicyEffect;
    reasons: string[];
  };
};
