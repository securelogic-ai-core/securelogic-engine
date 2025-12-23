"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeAuditSprintResult = normalizeAuditSprintResult;
function normalizeAuditSprintResult(result) {
    var _a, _b, _c, _d, _e, _f, _g;
    return {
        version: "v1",
        assessment: {
            name: "SecureLogic AI Audit Sprint"
        },
        executiveSummary: {
            narrative: result.executiveNarrative,
            enterpriseRiskScore: (_b = (_a = result.enterprise) === null || _a === void 0 ? void 0 : _a.totalRiskScore) !== null && _b !== void 0 ? _b : null,
            overallRisk: (_d = (_c = result.enterprise) === null || _c === void 0 ? void 0 : _c.severity) !== null && _d !== void 0 ? _d : "Unknown"
        },
        enterpriseOverview: (_e = result.enterprise) !== null && _e !== void 0 ? _e : {},
        materialRisks: (_g = (_f = result.materiality) === null || _f === void 0 ? void 0 : _f.materialRisks) !== null && _g !== void 0 ? _g : [],
        disclaimers: [
            "This assessment represents a point-in-time evaluation.",
            "This report does not constitute legal or regulatory advice."
        ]
    };
}
