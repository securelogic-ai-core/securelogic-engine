import { RiskScore } from "../contracts/RiskScore";
import { ControlAssessment } from "../contracts/ControlAssessment";
import { ControlRegistry } from "../registry/ControlRegistry";
import { ScoringInput } from "../contracts/ScoringInput";

export class ControlRiskScoringEngine {
  static score(
    assessments: ControlAssessment[],
    input: ScoringInput
  ): RiskScore[] {
    return assessments.map(a => {
      const definition =
        ControlRegistry.controls[a.controlPath];

      const modifierScore = a.satisfied ? 0 : 2;
      const maturityPenalty = a.satisfied ? 0 : 1;

      const totalRiskScore =
        definition.baseWeight +
        modifierScore +
        maturityPenalty;

      return {
        controlId: definition.id,
        baseWeight: definition.baseWeight,
        modifierScore,
        maturityPenalty,
        totalRiskScore,
        drivers: a.satisfied ? [] : ["Control not satisfied"],
        evidence: {
          controlId: definition.id,
          controlTitle: definition.title,
          observedState: {
  implemented: a.implemented,
  maturityLevel: a.maturityLevel,
  riskAccepted: a.riskAccepted,
  evidenceProvided: a.evidenceProvided
},
          scoringFactors: {
  baseWeight: definition.baseWeight,
  modifierScore,
  maturityPenalty,
  totalRiskScore
},
          rationale: `Risk derived from control ${definition.id} (${definition.title})`
        }
      };
    });
  }
}

