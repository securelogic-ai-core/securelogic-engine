"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScoringEngineV3 = void 0;
const ControlRegistry_1 = require("../registry/ControlRegistry");
class ScoringEngineV3 {
    static score(assessments) {
        const findings = assessments.map(assessment => {
            const definition = ControlRegistry_1.ControlRegistry.controls[assessment.controlPath];
            return {
                id: definition.id,
                title: definition.title,
                severity: assessment.satisfied ? "Low" : "High",
                likelihood: assessment.satisfied ? "Unlikely" : "Possible",
                framework: "Internal AI Risk Framework",
                rationale: `Risk derived from control ${definition.id} (${definition.title})`
            };
        });
        const overallRiskLevel = findings.some(f => f.severity === "Critical")
            ? "Critical"
            : findings.some(f => f.severity === "High")
                ? "High"
                : findings.some(f => f.severity === "Medium")
                    ? "Medium"
                    : "Low";
        return {
            overallRiskLevel,
            findings
        };
    }
}
exports.ScoringEngineV3 = ScoringEngineV3;
