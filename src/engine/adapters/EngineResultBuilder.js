"use strict";
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
exports.buildEngineResult = buildEngineResult;
var severityOrder = {
    Low: 1,
    Medium: 2,
    High: 3,
    Critical: 4
};
function buildEngineResult(findings) {
    var _a, _b;
    var severityBreakdown = {
        Low: 0,
        Medium: 0,
        High: 0,
        Critical: 0
    };
    for (var _i = 0, findings_1 = findings; _i < findings_1.length; _i++) {
        var f = findings_1[_i];
        severityBreakdown[f.severity]++;
    }
    var sorted = __spreadArray([], findings, true).sort(function (a, b) { return severityOrder[b.severity] - severityOrder[a.severity]; });
    var overallRiskLevel = sorted.length === 0 ? "Low" : (_b = (_a = sorted[0]) === null || _a === void 0 ? void 0 : _a.severity) !== null && _b !== void 0 ? _b : "Low";
    return {
        overallRiskLevel: overallRiskLevel,
        findings: sorted,
        severityBreakdown: severityBreakdown
    };
}
