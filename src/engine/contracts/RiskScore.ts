import type { EvidenceTrail } from "./EvidenceTrail";

export interface RiskScore {
  controlId: string;

  baseWeight: number;
  modifierScore: number;
  maturityPenalty: number;
  totalRiskScore: number;

  drivers: string[];

  evidence: EvidenceTrail;
}
