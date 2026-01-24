export type Decision = {
  decisionId: string;
  contextId: string;

  outcome: "APPROVED" | "APPROVED_WITH_CONDITIONS" | "REJECTED" | "NEEDS_REVIEW";
  riskRating: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

  conditions: {
    id: string;
    description: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
    dueBy?: string;
  }[];

  createdAt: string;

  policyBundleId: string;
  policyBundleHash: string;
};
