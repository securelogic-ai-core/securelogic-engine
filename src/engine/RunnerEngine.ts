import { ExceptionWeightingPolicy } from "./scoring/policy/ExceptionWeightingPolicy";

import { EnterpriseSeverityPolicy } from "./scoring/policy/EnterpriseSeverityPolicy";
import { CategoryMaterialityPolicy } from "./scoring/policy/CategoryMaterialityPolicy";
import { SystemInvariantValidator } from "./validators/SystemInvariantValidator";
import { ScoringInput } from "./contracts/ScoringInput";
import { AssessmentInferenceEngine } from "./scoring/AssessmentInferenceEngine";
import { ControlRiskScoringEngine } from "./scoring/ControlRiskScoringEngine";
import { EnterpriseRiskAggregationEngine } from "./scoring/EnterpriseRiskAggregationEngine";
import { ExecutiveNarrativeEngine } from "./scoring/ExecutiveNarrativeEngine";

export class RunnerEngine {
  static run(input: ScoringInput) {
    SystemInvariantValidator.validate();

    const assessments =
      AssessmentInferenceEngine.infer(input.controlState);

    const rawScores =
  ControlRiskScoringEngine.score(assessments, input);

const controlScores =
  ExceptionWeightingPolicy.apply(rawScores);

    let enterprise =
      EnterpriseRiskAggregationEngine.aggregate(controlScores);

    const severityDecision =
      EnterpriseSeverityPolicy.evaluate(enterprise);

    enterprise = {
      ...enterprise,
      severity: severityDecision.finalSeverity,
      severityRationale: severityDecision.rationale
    };

    enterprise =
      CategoryMaterialityPolicy.apply(enterprise);

    const narrative =
      ExecutiveNarrativeEngine.generate(enterprise);

    return {
      controls: controlScores,
      enterprise,
      executiveNarrative: narrative
    };
  }
}
