"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecureLogicAI = void 0;
const RiskDecisionEngine_1 = require("../engine/RiskDecisionEngine");
const ExecutiveRiskReportV2Builder_1 = require("../report/builders/ExecutiveRiskReportV2Builder");
const LicenseEntitlements_1 = require("./contracts/LicenseEntitlements");
class SecureLogicAI {
    static runAssessment(summary, license) {
        const decision = RiskDecisionEngine_1.RiskDecisionEngine.generate(summary);
        const entitlements = LicenseEntitlements_1.LICENSE_ENTITLEMENTS[license.tier];
        if (!entitlements.includesExecutiveReport) {
            return { decision };
        }
        const fullReport = ExecutiveRiskReportV2Builder_1.ExecutiveRiskReportV2Builder.build(summary);
        return {
            decision,
            report: {
                assessment: fullReport.assessment,
                summary: fullReport.summary,
                decision: fullReport.decision,
                executiveNarrative: fullReport.executiveNarrative,
                remediationPlan: entitlements.includesRemediationPlan
                    ? fullReport.remediationPlan
                    : undefined,
                pricing: entitlements.includesPricing
                    ? fullReport.pricing
                    : undefined
            }
        };
    }
}
exports.SecureLogicAI = SecureLogicAI;
