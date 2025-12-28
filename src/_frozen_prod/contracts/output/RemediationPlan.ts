/**
 * Remediation Plan — Product Output
 * ENTERPRISE, CLIENT-FACING
 */
export interface RemediationStep {
  id: string;
  description: string;
  priority: "Low" | "Medium" | "High";
}

export interface RemediationPlan {
  summary: string;
  steps: RemediationStep[];
}
