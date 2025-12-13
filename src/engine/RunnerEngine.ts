import { CategoryCompoundingRiskPolicy } from "./scoring/policy/CategoryCompoundingRiskPolicy";
import { EnterpriseEscalationPolicy } from "./scoring/policy/EnterpriseEscalationPolicy";
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

    // 1. Base severity decision (adds rationale)
    const severityDecision =
      EnterpriseSeverityPolicy.evaluate(enterprise);

    enterprise = {
      ...enterprise,
      severity: severityDecision.finalSeverity,
      severityRationale: [
        ...(enterprise.severityRationale ?? []),
        ...severityDecision.rationale
      ]
    };

    // 2. Escalation policies (each appends rationale)
    enterprise = CategoryMaterialityPolicy.apply(enterprise);
    enterprise = EnterpriseEscalationPolicy.apply(enterprise);
    enterprise = CategoryCompoundingRiskPolicy.apply(enterprise);

    const narrative =
      ExecutiveNarrativeEngine.generate(enterprise);

    return {
      controls: controlScores,
      enterprise,
      executiveNarrative: narrative
    };
  }
}
