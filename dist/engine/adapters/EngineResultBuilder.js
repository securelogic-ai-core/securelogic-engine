"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildEngineResult = buildEngineResult;
const severityOrder = {
    Low: 1,
    Medium: 2,
    High: 3,
    Critical: 4
};
function buildEngineResult(findings) {
    const severityBreakdown = {
        Low: 0,
        Medium: 0,
        High: 0,
        Critical: 0
    };
    for (const f of findings) {
        severityBreakdown[f.severity]++;
    }
    const sorted = [...findings].sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity]);
    const overallRiskLevel = sorted.length === 0 ? "Low" : sorted[0]?.severity ?? "Low";
    return {
        overallRiskLevel,
        findings: sorted,
        severityBreakdown
    };
}
