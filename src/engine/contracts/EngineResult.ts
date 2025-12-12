export type SeverityLevel =
  | "Low"
  | "Medium"
  | "High"
  | "Critical";

export type LikelihoodLevel =
  | "Unlikely"
  | "Possible"
  | "Likely";

export interface EngineFinding {
  id: string;
  title: string;
  severity: SeverityLevel;
  likelihood: LikelihoodLevel;
  framework: string; // ← intentionally open-ended
  rationale: string;
}

export interface EngineResult {
  overallRiskLevel: SeverityLevel;
  findings: EngineFinding[];
  severityBreakdown?: Record<SeverityLevel, number>;
}
