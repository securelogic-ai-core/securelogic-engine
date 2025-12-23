"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnterpriseRiskAggregationEngine = void 0;
var RiskSeverityEngine_1 = require("./RiskSeverityEngine");
var ControlRegistry_1 = require("../registry/ControlRegistry");
var DomainWeightPolicy_1 = require("../policy/DomainWeightPolicy");
var EnterpriseRiskAggregationEngine = /** @class */ (function () {
    function EnterpriseRiskAggregationEngine() {
    }
    EnterpriseRiskAggregationEngine.aggregate = function (scores) {
        var _a, _b, _c;
        var categoryTotals = {};
        var domainScores = [];
        var drivers = new Set();
        var _loop_1 = function (score) {
            var definition = Object.values(ControlRegistry_1.ControlRegistry.controls).find(function (c) { return c.id === score.controlId; });
            var domain = (_a = definition === null || definition === void 0 ? void 0 : definition.domain) !== null && _a !== void 0 ? _a : "Uncategorized";
            var weight = (_b = DomainWeightPolicy_1.DOMAIN_WEIGHTS[domain]) !== null && _b !== void 0 ? _b : 1.0;
            var weightedScore = score.totalRiskScore * weight;
            categoryTotals[domain] =
                ((_c = categoryTotals[domain]) !== null && _c !== void 0 ? _c : 0) + weightedScore;
            score.drivers.forEach(function (d) { return drivers.add(d); });
            domainScores.push({
                domain: domain,
                score: weightedScore,
                severity: RiskSeverityEngine_1.RiskSeverityEngine.fromScore(weightedScore)
            });
        };
        for (var _i = 0, scores_1 = scores; _i < scores_1.length; _i++) {
            var score = scores_1[_i];
            _loop_1(score);
        }
        var overallScore = Object.values(categoryTotals).reduce(function (a, b) { return a + b; }, 0);
        var categoryScores = Object.entries(categoryTotals).map(function (_a) {
            var category = _a[0], score = _a[1];
            return ({
                category: category,
                score: score,
                severity: RiskSeverityEngine_1.RiskSeverityEngine.fromScore(score)
            });
        });
        var severity = RiskSeverityEngine_1.RiskSeverityEngine.fromScore(overallScore);
        var recommendedActions = [];
        return {
            overallScore: overallScore,
            enterpriseRiskScore: overallScore,
            severity: severity,
            domainScores: domainScores,
            categoryScores: categoryScores,
            topRiskDrivers: Array.from(drivers).slice(0, 5),
            severityRationale: [],
            recommendedActions: recommendedActions
        };
    };
    return EnterpriseRiskAggregationEngine;
}());
exports.EnterpriseRiskAggregationEngine = EnterpriseRiskAggregationEngine;
