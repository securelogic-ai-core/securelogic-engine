"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnterpriseEscalationPolicy = void 0;
var RiskSeverity_1 = require("../../contracts/RiskSeverity");
var EnterpriseEscalationPolicy = /** @class */ (function () {
    function EnterpriseEscalationPolicy() {
    }
    EnterpriseEscalationPolicy.apply = function (summary) {
        var _a;
        var exceptionCount = summary.topRiskDrivers.filter(function (d) { return d === "Unmitigated control exception"; }).length;
        if (exceptionCount >= 2) {
            return __assign(__assign({}, summary), { severity: summary.severity === RiskSeverity_1.RISK_SEVERITY.Critical
                    ? RiskSeverity_1.RISK_SEVERITY.Critical
                    : RiskSeverity_1.RISK_SEVERITY.High, severityRationale: __spreadArray(__spreadArray([], ((_a = summary.severityRationale) !== null && _a !== void 0 ? _a : []), true), [
                    "Multiple unmitigated control exceptions triggered enterprise escalation"
                ], false) });
        }
        return summary;
    };
    return EnterpriseEscalationPolicy;
}());
exports.EnterpriseEscalationPolicy = EnterpriseEscalationPolicy;
