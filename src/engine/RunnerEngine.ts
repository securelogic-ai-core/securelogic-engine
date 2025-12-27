import { CategoryCompoundingRiskPolicy } from "./scoring/policy/CategoryCompoundingRiskPolicy";
import { CategoryMaterialityPolicy } from "./scoring/policy/CategoryMaterialityPolicy";
import { EnterpriseEscalationPolicy } from "./scoring/policy/EnterpriseEscalationPolicy";
import { EnterpriseSeverityPolicy } from "./scoring/policy/EnterpriseSeverityPolicy";
import { ExceptionWeightingPolicy } from "./scoring/policy/ExceptionWeightingPolicy";
import { MaterialityEngine } from "./materiality/MaterialityEngine";
import { SystemInvariantValidator } from "./validators/SystemInvariantValidator";
import type { ScoringInput } from "./contracts/ScoringInput";
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

    // Base severity decision
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

    // Escalation policies
    enterprise = CategoryMaterialityPolicy.apply(enterprise);
    enterprise = EnterpriseEscalationPolicy.apply(enterprise);
    enterprise = CategoryCompoundingRiskPolicy.apply(enterprise);

    // Materiality is computed OUTSIDE the enterprise object
    const materiality =
      MaterialityEngine.evaluate(enterprise);

    const executiveNarrative =
      ExecutiveNarrativeEngine.generate(enterprise);

    return {
      controls: controlScores,
      enterprise,
      materiality,
      executiveNarrative
    };
  }
}
