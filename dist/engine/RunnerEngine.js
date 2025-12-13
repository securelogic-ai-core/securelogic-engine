"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunnerEngine = void 0;
const ExceptionWeightingPolicy_1 = require("./scoring/policy/ExceptionWeightingPolicy");
const EnterpriseSeverityPolicy_1 = require("./scoring/policy/EnterpriseSeverityPolicy");
const CategoryMaterialityPolicy_1 = require("./scoring/policy/CategoryMaterialityPolicy");
const SystemInvariantValidator_1 = require("./validators/SystemInvariantValidator");
const AssessmentInferenceEngine_1 = require("./scoring/AssessmentInferenceEngine");
const ControlRiskScoringEngine_1 = require("./scoring/ControlRiskScoringEngine");
const EnterpriseRiskAggregationEngine_1 = require("./scoring/EnterpriseRiskAggregationEngine");
const ExecutiveNarrativeEngine_1 = require("./scoring/ExecutiveNarrativeEngine");
class RunnerEngine {
    static run(input) {
        SystemInvariantValidator_1.SystemInvariantValidator.validate();
        const assessments = AssessmentInferenceEngine_1.AssessmentInferenceEngine.infer(input.controlState);
        const rawScores = ControlRiskScoringEngine_1.ControlRiskScoringEngine.score(assessments, input);
        const controlScores = ExceptionWeightingPolicy_1.ExceptionWeightingPolicy.apply(rawScores);
        let enterprise = EnterpriseRiskAggregationEngine_1.EnterpriseRiskAggregationEngine.aggregate(controlScores);
        const severityDecision = EnterpriseSeverityPolicy_1.EnterpriseSeverityPolicy.evaluate(enterprise);
        enterprise = {
            ...enterprise,
            severity: severityDecision.finalSeverity,
            severityRationale: severityDecision.rationale
        };
        enterprise =
            CategoryMaterialityPolicy_1.CategoryMaterialityPolicy.apply(enterprise);
        const narrative = ExecutiveNarrativeEngine_1.ExecutiveNarrativeEngine.generate(enterprise);
        return {
            controls: controlScores,
            enterprise,
            executiveNarrative: narrative
        };
    }
}
exports.RunnerEngine = RunnerEngine;
