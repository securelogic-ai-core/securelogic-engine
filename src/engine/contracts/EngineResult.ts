export type RiskLevel = "Low" | "Moderate" | "High" | "Critical";

export interface EngineFinding {
  id: string;
  title: string;
  severity: RiskLevel;
  likelihood: "Unlikely" | "Possible" | "Likely";
  framework: "NIST AI RMF" | "ISO 42001" | "SOC 2";
  rationale: string;
}

export interface EngineResult {
  overallRiskLevel: RiskLevel;
  findings: EngineFinding[];
  severityBreakdown: Record<RiskLevel, number>;
  recommendedSprint: "Advisory" | "Remediation" | "Managed";
  monetizationSignal: {
    urgency: "Low" | "Medium" | "High";
    estimatedDealValue: number;
  };
}
