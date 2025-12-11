"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildEngineResult = buildEngineResult;
function buildEngineResult(findings) {
    const severityBreakdown = {
        Low: 0,
        Moderate: 0,
        High: 0,
        Critical: 0
    };
    findings.forEach(f => {
        severityBreakdown[f.severity]++;
    });
    const overallRiskLevel = severityBreakdown.Critical > 0 ? "Critical" :
        severityBreakdown.High > 0 ? "High" :
            severityBreakdown.Moderate > 0 ? "Moderate" :
                "Low";
    const recommendedSprint = overallRiskLevel === "Critical" ? "Managed" :
        overallRiskLevel === "High" ? "Remediation" :
            "Advisory";
    const urgency = overallRiskLevel === "Critical" || overallRiskLevel === "High"
        ? "High"
        : overallRiskLevel === "Moderate"
            ? "Medium"
            : "Low";
    const estimatedDealValue = urgency === "High" ? 25000 :
        urgency === "Medium" ? 7500 :
            2500;
    return {
        overallRiskLevel,
        findings,
        severityBreakdown,
        recommendedSprint,
        monetizationSignal: {
            urgency,
            estimatedDealValue
        }
    };
}
