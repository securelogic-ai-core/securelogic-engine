import { RiskDomain } from "./RiskDomain";
import { RiskLevel } from "./RiskLevel";

export interface RiskFinding {
  domain: RiskDomain;
  level: RiskLevel;
  score: number; // 0–100
  summary: string;
  evidenceCount: number;
}
