export interface RiskScore {
  score: number;
  band: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  rationale: string[];
}
