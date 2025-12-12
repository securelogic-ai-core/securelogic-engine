"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiskSeverityEngine = void 0;
class RiskSeverityEngine {
    static fromScore(score) {
        if (score >= 80)
            return "Critical";
        if (score >= 60)
            return "High";
        if (score >= 35)
            return "Moderate";
        return "Low";
    }
}
exports.RiskSeverityEngine = RiskSeverityEngine;
