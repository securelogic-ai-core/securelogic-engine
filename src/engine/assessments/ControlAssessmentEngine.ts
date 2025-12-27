import type { ScoringInput } from "../contracts/ScoringInput";
import type { ControlAssessment } from "../contracts/ControlAssessment";
import { ControlRegistry } from "../registry/ControlRegistry";

export class ControlAssessmentEngine {
  static assess(_input: ScoringInput): ControlAssessment[] {
    return Object.keys(ControlRegistry.controls).map(controlId => ({
      controlId,
      controlPath: controlId,
      implemented: false,
      satisfied: false,
      maturityLevel: 0,
      riskAccepted: false,
      evidenceProvided: false
    }));
  }
}
