/**
 * Executive Summary — Product Output
 * ENTERPRISE, CLIENT-FACING
 */
export interface ExecutiveSummary {
  headlineRisk: "Low" | "Moderate" | "High" | "Critical";
  rationale: string;
  keyDrivers: string[];
}
