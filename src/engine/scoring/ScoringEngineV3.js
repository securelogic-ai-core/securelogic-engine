"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScoringEngineV3 = void 0;
var ControlRegistry_1 = require("../registry/ControlRegistry");
var ScoringEngineV3 = /** @class */ (function () {
    function ScoringEngineV3() {
    }
    ScoringEngineV3.score = function (assessments) {
        var findings = assessments.map(function (assessment) {
            var definition = ControlRegistry_1.ControlRegistry.controls[assessment.controlPath];
            return {
                id: definition.id,
                title: definition.title,
                severity: assessment.satisfied ? "Low" : "High",
                likelihood: assessment.satisfied ? "Unlikely" : "Possible",
                framework: "Internal AI Risk Framework",
                rationale: "Risk derived from control ".concat(definition.id, " (").concat(definition.title, ")")
            };
        });
        var overallRiskLevel = findings.some(function (f) { return f.severity === "Critical"; })
            ? "Critical"
            : findings.some(function (f) { return f.severity === "High"; })
                ? "High"
                : findings.some(function (f) { return f.severity === "Medium"; })
                    ? "Medium"
                    : "Low";
        return {
            overallRiskLevel: overallRiskLevel,
            findings: findings
        };
    };
    return ScoringEngineV3;
}());
exports.ScoringEngineV3 = ScoringEngineV3;
