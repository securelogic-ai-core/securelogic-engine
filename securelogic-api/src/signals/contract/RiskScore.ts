export interface RiskScore {
  score: number;          // 0–100
  band: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  rationale: string[];
}
