export interface EvidenceTrail {
  controlId: string;
  controlTitle: string;

  observedState: {
    implemented: boolean;
    maturityLevel: number;
    riskAccepted: boolean;
  };

  scoringFactors: {
    baseWeight: number;
    modifierScore: number;
    maturityPenalty: number;
    totalRiskScore: number;
  };

  rationale: string;
}