"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecureLogicAI = void 0;
var RiskDecisionEngine_1 = require("../engine/RiskDecisionEngine");
var ExecutiveRiskReportV2Builder_1 = require("../report/builders/ExecutiveRiskReportV2Builder");
var LicenseEntitlements_1 = require("./contracts/LicenseEntitlements");
var SecureLogicAI = /** @class */ (function () {
    function SecureLogicAI() {
    }
    SecureLogicAI.runAssessment = function (summary, license) {
        var decision = RiskDecisionEngine_1.RiskDecisionEngine.generate(summary);
        var entitlements = LicenseEntitlements_1.LICENSE_ENTITLEMENTS[license.tier];
        if (!entitlements.includesExecutiveReport) {
            return { decision: decision };
        }
        var fullReport = ExecutiveRiskReportV2Builder_1.ExecutiveRiskReportV2Builder.build(summary);
        return {
            decision: decision,
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
    };
    return SecureLogicAI;
}());
exports.SecureLogicAI = SecureLogicAI;
