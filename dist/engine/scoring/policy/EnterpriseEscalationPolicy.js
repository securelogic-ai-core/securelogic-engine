"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnterpriseEscalationPolicy = void 0;
class EnterpriseEscalationPolicy {
    static apply(summary) {
        const exceptionCount = summary.topRiskDrivers.filter(d => d === "Unmitigated control exception").length;
        if (exceptionCount >= 2) {
            return {
                ...summary,
                severity: summary.severity === "Critical" ? "Critical" : "High",
                severityRationale: [
                    ...(summary.severityRationale ?? []),
                    "Multiple unmitigated control exceptions triggered enterprise escalation"
                ]
            };
        }
        return summary;
    }
}
exports.EnterpriseEscalationPolicy = EnterpriseEscalationPolicy;
