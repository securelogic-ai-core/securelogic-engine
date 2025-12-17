"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiskSeverityEngine = void 0;
const RiskSeverity_1 = require("../contracts/RiskSeverity");
class RiskSeverityEngine {
    static fromScore(score) {
        if (score >= 76)
            return RiskSeverity_1.RISK_SEVERITY.Critical;
        if (score >= 56)
            return RiskSeverity_1.RISK_SEVERITY.High;
        if (score >= 31)
            return RiskSeverity_1.RISK_SEVERITY.Moderate;
        return RiskSeverity_1.RISK_SEVERITY.Low;
    }
}
exports.RiskSeverityEngine = RiskSeverityEngine;
