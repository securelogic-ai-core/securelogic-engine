/**
 * SecureLogic AI – Risk Decision Output
 * Version: 1.0.0
 * Status: Frozen
 *
 * This contract defines the canonical, client-facing
 * output of the SecureLogic AI decision engine.
 */

export type RiskLevel =
  | "Low"
  | "Moderate"
  | "High"
  | "Critical";

export type ApprovalStatus =
  | "Approved"
  | "Conditional"
  | "Rejected";

export interface HeatMapPoint {
  domain: string;            // e.g. Governance, Security, Data
  impact: number;            // 0–100
  likelihood: number;        // 0–100
}

export interface RemediationDecision {
  id: string;
  description: string;
  estimatedRiskReduction: number; // 0–100
  priority: "Low" | "Moderate" | "High" | "Critical";
}

export interface RiskDecisionOutput {
  // Engine metadata
  engineVersion: "1.0.0";
  generatedAt: string; // ISO 8601 timestamp

  // Core decision
  score: number;       // 0–100
  level: RiskLevel;
  approvalStatus: ApprovalStatus;

  // Explanation
  dominantDomains: string[];
  severityRationale: string[];

  // Visualization inputs
  heatMap: HeatMapPoint[];

  // Actionability
  remediationPlan: RemediationDecision[];
}
