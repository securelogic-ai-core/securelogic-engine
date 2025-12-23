"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeverityNormalizationEngine = void 0;
var RiskSeverity_1 = require("../../contracts/RiskSeverity");
/**
 * Single source of truth for severity escalation and normalization.
 * No engine or policy may assign severity directly.
 */
var SeverityNormalizationEngine = /** @class */ (function () {
    function SeverityNormalizationEngine() {
    }
    SeverityNormalizationEngine.normalize = function (input) {
        switch (input) {
            case RiskSeverity_1.RISK_SEVERITY.Critical:
            case "Critical":
                return RiskSeverity_1.RISK_SEVERITY.Critical;
            case RiskSeverity_1.RISK_SEVERITY.High:
            case "High":
                return RiskSeverity_1.RISK_SEVERITY.High;
            case RiskSeverity_1.RISK_SEVERITY.Moderate:
            case "Moderate":
                return RiskSeverity_1.RISK_SEVERITY.Moderate;
            case RiskSeverity_1.RISK_SEVERITY.Low:
            case "Low":
            default:
                return RiskSeverity_1.RISK_SEVERITY.Low;
        }
    };
    SeverityNormalizationEngine.escalate = function (current, target) {
        var order = [
            RiskSeverity_1.RISK_SEVERITY.Low,
            RiskSeverity_1.RISK_SEVERITY.Moderate,
            RiskSeverity_1.RISK_SEVERITY.High,
            RiskSeverity_1.RISK_SEVERITY.Critical
        ];
        return order.indexOf(target) > order.indexOf(current)
            ? target
            : current;
    };
    return SeverityNormalizationEngine;
}());
exports.SeverityNormalizationEngine = SeverityNormalizationEngine;
