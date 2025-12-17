export type RiskLevel = "Low" | "Moderate" | "High" | "Critical";

export type ApprovalStatus = "Approved" | "Conditional" | "Rejected";

export interface HeatMapPoint {
  domain: string;
  impact: number;
  likelihood: number;
}

export interface RemediationDecision {
  id: string;
  description: string;
  estimatedRiskReduction: number;
  priority: string;
}

export interface RiskDecision {
  score: number;
  level: RiskLevel;

  dominantDomains: string[];
  severityRationale: string[];

  heatMap: HeatMapPoint[];
  remediationPlan: RemediationDecision[];

  approvalStatus: ApprovalStatus;
}
