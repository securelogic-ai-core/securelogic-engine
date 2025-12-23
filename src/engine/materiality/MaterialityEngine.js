"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MaterialityEngine = void 0;
var MaterialityEngine = /** @class */ (function () {
    function MaterialityEngine() {
    }
    MaterialityEngine.evaluate = function (enterprise) {
        var _this = this;
        var total = enterprise.overallScore;
        var risks = enterprise.categoryScores
            .map(function (c) {
            var contribution = (c.score / total) * 100;
            return {
                id: "MR-".concat(c.category.toUpperCase()),
                title: "".concat(c.category, " AI Risk"),
                category: c.category,
                severity: c.severity,
                contributionPercent: Number(contribution.toFixed(1)),
                whyItMatters: _this.translateCategory(c.category)
            };
        })
            .filter(function (r) { return r.contributionPercent >= 10 || r.category === "Governance"; })
            .filter(function (r) { return r.severity !== "Low"; })
            .sort(function (a, b) { return b.contributionPercent - a.contributionPercent; })
            .slice(0, 5);
        var overallRating = enterprise.severity === "High"
            ? "High"
            : enterprise.severity === "Moderate"
                ? "Moderate"
                : "Low";
        return {
            overallRating: overallRating,
            materialRisks: risks,
            rationale: enterprise.severityRationale
        };
    };
    MaterialityEngine.translateCategory = function (category) {
        switch (category) {
            case "Governance":
                return "Lack of AI governance increases regulatory, legal, and reputational exposure.";
            case "Monitoring":
                return "Insufficient model monitoring increases the likelihood of undetected failures and bias.";
            case "Business Continuity":
                return "AI system outages may disrupt critical operations and recovery capabilities.";
            default:
                return "Unmanaged AI risk may negatively impact business objectives.";
        }
    };
    return MaterialityEngine;
}());
exports.MaterialityEngine = MaterialityEngine;
