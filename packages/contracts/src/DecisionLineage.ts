type DecisionLineage = {
  // ---- Schema & Engine Identity ----
  schemaVersion: "1.0";
  engineVersion: string;

  // ---- Decision Identity ----
  decisionId: string;
  contextId: string;

  // ---- Policy Provenance (CRITICAL) ----
  policyBundleId: string;
  policyBundleHash: string; // cryptographic fingerprint of the executed policy bundle

  // ---- Evidence Snapshot ----
  findingsSnapshot: {
    id: string;
    controlId: string;
    title: string;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    evidence?: string;
  }[];

  // ---- Policy Execution Trace ----
  policyEvaluations: {
    policyId: string;
    effect: "ALLOW" | "DENY" | "REQUIRE_REVIEW";
    reason: string | null;
  }[];

  // ---- Risk Computation Trace ----
  riskComputation: {
    method: string;       // e.g. "scoreFindings()"
    finalRisk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  };

  // ---- Aggregation / Decision Logic Trace ----
  aggregation: {
    rule: string;         // e.g. "RiskScore + PolicyOverrides"
    finalOutcome: "APPROVED" | "APPROVED_WITH_CONDITIONS" | "REJECTED" | "NEEDS_REVIEW";
    finalRisk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  };

  // ---- Timestamp ----
  createdAt: string; // ISO timestamp
};
