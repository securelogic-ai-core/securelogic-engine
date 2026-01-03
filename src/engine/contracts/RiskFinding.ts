import type { RiskDomain } from "./RiskDomain.js";
import type { RiskLevel } from "./RiskLevel.js";

export interface RiskFinding {
  domain: RiskDomain;
  level: RiskLevel;
  score: number; // 0–100
  summary: string;
  evidenceCount: number;
}
