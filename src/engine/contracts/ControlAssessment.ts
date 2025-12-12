export interface ControlAssessment {
  controlId: string;
  controlPath: string;

  satisfied: boolean;
  implemented: boolean;
  maturityLevel: number;
  evidenceProvided: boolean;
  riskAccepted: boolean;
}