"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adaptToAuditSprintReportV1 = adaptToAuditSprintReportV1;
function adaptToAuditSprintReportV1(engineResult) {
    return {
        version: "v1",
        assessment: {
            name: "Enterprise AI Risk Assessment",
            date: engineResult.assessmentDate
        },
        executiveSummary: {
            overallRisk: engineResult.enterprise.severity,
            enterpriseRiskScore: engineResult.enterprise.enterpriseRiskScore,
            approvalStatus: engineResult.enterprise.approvalStatus,
            narrative: engineResult.executiveNarrative
        },
        enterpriseOverview: {
            totalRiskScore: engineResult.enterprise.enterpriseRiskScore,
            severity: engineResult.enterprise.severity,
            topRiskDomains: engineResult.enterprise.domainScores
                .sort(function (a, b) { return b.score - a.score; })
                .map(function (d) { return d.domain; })
                .slice(0, 3)
        },
        materialRisks: engineResult.materiality.materialRisks,
        controlGaps: engineResult.controls.map(function (c) {
            var _a;
            return ({
                controlId: c.controlId,
                domain: (_a = c.domain) !== null && _a !== void 0 ? _a : "Unknown",
                issue: c.drivers.join(", ")
            });
        }),
        recommendedActions: engineResult.enterprise.recommendedActions.map(function (a) {
            var _a;
            return ({
                action: (_a = a.title) !== null && _a !== void 0 ? _a : a.action,
                priority: a.priority,
                riskAddressed: a.risk
            });
        }),
        disclaimers: [
            "This assessment represents a point-in-time evaluation.",
            "Results are based on information provided at the time of assessment.",
            "This report does not constitute a legal or regulatory guarantee."
        ]
    };
}
