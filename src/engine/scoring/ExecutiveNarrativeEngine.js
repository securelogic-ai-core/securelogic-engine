"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutiveNarrativeEngine = void 0;
var ExecutiveNarrativeEngine = /** @class */ (function () {
    function ExecutiveNarrativeEngine() {
    }
    ExecutiveNarrativeEngine.generate = function (summary) {
        var drivers = summary.topRiskDrivers.join(", ");
        if (summary.severity === "Critical") {
            return "The enterprise exhibits a critical risk posture driven by ".concat(drivers, ". Immediate executive action is required to mitigate material exposure.");
        }
        if (summary.severity === "High") {
            return "The organization faces elevated enterprise risk primarily due to ".concat(drivers, ". Strategic remediation should be prioritized to prevent escalation.");
        }
        if (summary.severity === "Moderate") {
            return "Moderate enterprise risk has been identified, with contributing factors including ".concat(drivers, ". Continued monitoring and targeted controls are recommended.");
        }
        return "The enterprise maintains a low overall risk profile with no material systemic concerns identified at this time.";
    };
    return ExecutiveNarrativeEngine;
}());
exports.ExecutiveNarrativeEngine = ExecutiveNarrativeEngine;
