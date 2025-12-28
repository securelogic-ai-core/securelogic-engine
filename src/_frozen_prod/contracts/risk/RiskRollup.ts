/**
 * Risk Rollup — V1
 *
 * Board-level risk posture derived from findings.
 * ENTERPRISE DECISION CONTRACT
 */
export interface RiskRollupV1 {
  overallRisk: "Low" | "Moderate" | "High" | "Critical";

  numericScore: number; // 0–100

  findingCounts: {
    Low: number;
    Medium: number;
    High: number;
    Critical: number;
  };

  rationale: string;
}
