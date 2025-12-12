"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunnerEngine = void 0;
const SystemInvariantValidator_1 = require("./validators/SystemInvariantValidator");
const AssessmentInferenceEngine_1 = require("./scoring/AssessmentInferenceEngine");
const ControlRiskScoringEngine_1 = require("./scoring/ControlRiskScoringEngine");
const EnterpriseRiskAggregationEngine_1 = require("./scoring/EnterpriseRiskAggregationEngine");
const ExecutiveNarrativeEngine_1 = require("./scoring/ExecutiveNarrativeEngine");
class RunnerEngine {
    static run(input) {
        SystemInvariantValidator_1.SystemInvariantValidator.validate();
        const assessments = AssessmentInferenceEngine_1.AssessmentInferenceEngine.infer(input.controlState);
        const controlScores = ControlRiskScoringEngine_1.ControlRiskScoringEngine.score(assessments, input);
        const enterprise = EnterpriseRiskAggregationEngine_1.EnterpriseRiskAggregationEngine.aggregate(controlScores);
        const narrative = ExecutiveNarrativeEngine_1.ExecutiveNarrativeEngine.generate(enterprise);
        return {
            controls: controlScores,
            enterprise,
            executiveNarrative: narrative
        };
    }
}
exports.RunnerEngine = RunnerEngine;
