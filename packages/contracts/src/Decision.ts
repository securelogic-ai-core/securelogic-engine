export type Decision = {
  outcome: "APPROVED" | "APPROVED_WITH_CONDITIONS" | "REJECTED" | "NEEDS_REVIEW";
  risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  reasons?: string[];
};
