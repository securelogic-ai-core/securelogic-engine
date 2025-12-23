"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunnerEngine = void 0;
var CategoryCompoundingRiskPolicy_1 = require("./scoring/policy/CategoryCompoundingRiskPolicy");
var CategoryMaterialityPolicy_1 = require("./scoring/policy/CategoryMaterialityPolicy");
var EnterpriseEscalationPolicy_1 = require("./scoring/policy/EnterpriseEscalationPolicy");
var EnterpriseSeverityPolicy_1 = require("./scoring/policy/EnterpriseSeverityPolicy");
var ExceptionWeightingPolicy_1 = require("./scoring/policy/ExceptionWeightingPolicy");
var MaterialityEngine_1 = require("./materiality/MaterialityEngine");
var SystemInvariantValidator_1 = require("./validators/SystemInvariantValidator");
var AssessmentInferenceEngine_1 = require("./scoring/AssessmentInferenceEngine");
var ControlRiskScoringEngine_1 = require("./scoring/ControlRiskScoringEngine");
var EnterpriseRiskAggregationEngine_1 = require("./scoring/EnterpriseRiskAggregationEngine");
var ExecutiveNarrativeEngine_1 = require("./scoring/ExecutiveNarrativeEngine");
var RunnerEngine = /** @class */ (function () {
    function RunnerEngine() {
    }
    RunnerEngine.run = function (input) {
        var _a;
        SystemInvariantValidator_1.SystemInvariantValidator.validate();
        var assessments = AssessmentInferenceEngine_1.AssessmentInferenceEngine.infer(input.controlState);
        var rawScores = ControlRiskScoringEngine_1.ControlRiskScoringEngine.score(assessments, input);
        var controlScores = ExceptionWeightingPolicy_1.ExceptionWeightingPolicy.apply(rawScores);
        var enterprise = EnterpriseRiskAggregationEngine_1.EnterpriseRiskAggregationEngine.aggregate(controlScores);
        // Base severity decision
        var severityDecision = EnterpriseSeverityPolicy_1.EnterpriseSeverityPolicy.evaluate(enterprise);
        enterprise = __assign(__assign({}, enterprise), { severity: severityDecision.finalSeverity, severityRationale: __spreadArray(__spreadArray([], ((_a = enterprise.severityRationale) !== null && _a !== void 0 ? _a : []), true), severityDecision.rationale, true) });
        // Escalation policies
        enterprise = CategoryMaterialityPolicy_1.CategoryMaterialityPolicy.apply(enterprise);
        enterprise = EnterpriseEscalationPolicy_1.EnterpriseEscalationPolicy.apply(enterprise);
        enterprise = CategoryCompoundingRiskPolicy_1.CategoryCompoundingRiskPolicy.apply(enterprise);
        // Materiality is computed OUTSIDE the enterprise object
        var materiality = MaterialityEngine_1.MaterialityEngine.evaluate(enterprise);
        var executiveNarrative = ExecutiveNarrativeEngine_1.ExecutiveNarrativeEngine.generate(enterprise);
        return {
            controls: controlScores,
            enterprise: enterprise,
            materiality: materiality,
            executiveNarrative: executiveNarrative
        };
    };
    return RunnerEngine;
}());
exports.RunnerEngine = RunnerEngine;
