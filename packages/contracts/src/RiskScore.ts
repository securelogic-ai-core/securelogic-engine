import type { EvidenceTrail } from "./EvidenceTrail.js";

export interface RiskScore {
  controlId: string;

  baseWeight: number;
  modifierScore: number;
  maturityPenalty: number;
  totalRiskScore: number;

  drivers: string[];

  evidence: EvidenceTrail;
}
