"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiskSeverityEngine = void 0;
var RiskSeverity_1 = require("../contracts/RiskSeverity");
var RiskSeverityEngine = /** @class */ (function () {
    function RiskSeverityEngine() {
    }
    RiskSeverityEngine.fromScore = function (score) {
        if (score >= 76)
            return RiskSeverity_1.RISK_SEVERITY.Critical;
        if (score >= 56)
            return RiskSeverity_1.RISK_SEVERITY.High;
        if (score >= 31)
            return RiskSeverity_1.RISK_SEVERITY.Moderate;
        return RiskSeverity_1.RISK_SEVERITY.Low;
    };
    return RiskSeverityEngine;
}());
exports.RiskSeverityEngine = RiskSeverityEngine;
