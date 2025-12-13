"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiskSeverityEngine = void 0;
class RiskSeverityEngine {
    static fromScore(score) {
        if (score >= 60)
            return "Critical";
        if (score >= 40)
            return "High";
        if (score >= 20)
            return "Moderate";
        return "Low";
    }
}
exports.RiskSeverityEngine = RiskSeverityEngine;
