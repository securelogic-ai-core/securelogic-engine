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

    const controlScores =
      ControlRiskScoringEngine.score(assessments, input);

    const enterprise =
      EnterpriseRiskAggregationEngine.aggregate(controlScores);

    const narrative =
      ExecutiveNarrativeEngine.generate(enterprise);

    return {
      controls: controlScores,
      enterprise,
      executiveNarrative: narrative
    };
  }
}
