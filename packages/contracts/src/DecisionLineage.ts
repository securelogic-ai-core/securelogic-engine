export type DecisionLineage = {
  schemaVersion: "1.0";
  engineVersion: string;

  decisionId: string;
  contextId: string;

  policyBundleId: string;
  policyBundleHash: string;

  findingsSnapshot: {
    id: string;
    controlId: string;
    title: string;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    evidence?: string;
  }[];

  policyEvaluations: {
    policyId: string;
    effect: "ALLOW" | "DENY" | "REQUIRE_REVIEW";
    reason: string | null;
  }[];

  riskComputation: {
    method: string;
    finalRisk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  };

  aggregation: {
    rule: string;
    finalOutcome: "APPROVED" | "APPROVED_WITH_CONDITIONS" | "REJECTED" | "NEEDS_REVIEW";
    finalRisk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  };

  createdAt: string;
};
