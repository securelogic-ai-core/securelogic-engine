"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiskHeatmapEngine = void 0;
var RiskHeatmapEngine = /** @class */ (function () {
    function RiskHeatmapEngine() {
    }
    RiskHeatmapEngine.generate = function (scores) {
        var cells = [];
        var impacts = ["Low", "Medium", "High"];
        var likelihoods = ["Low", "Medium", "High"];
        for (var _i = 0, impacts_1 = impacts; _i < impacts_1.length; _i++) {
            var impact = impacts_1[_i];
            for (var _a = 0, likelihoods_1 = likelihoods; _a < likelihoods_1.length; _a++) {
                var likelihood = likelihoods_1[_a];
                cells.push({
                    impact: impact,
                    likelihood: likelihood,
                    risks: []
                });
            }
        }
        var _loop_1 = function (score) {
            var impact = score.totalRiskScore >= 8 ? "High" :
                score.totalRiskScore >= 4 ? "Medium" : "Low";
            var likelihood = score.maturityPenalty >= 2 ? "High" :
                score.maturityPenalty === 1 ? "Medium" : "Low";
            var cell = cells.find(function (c) { return c.impact === impact && c.likelihood === likelihood; });
            cell === null || cell === void 0 ? void 0 : cell.risks.push(score);
        };
        for (var _b = 0, scores_1 = scores; _b < scores_1.length; _b++) {
            var score = scores_1[_b];
            _loop_1(score);
        }
        return cells;
    };
    return RiskHeatmapEngine;
}());
exports.RiskHeatmapEngine = RiskHeatmapEngine;
