"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutiveRiskReportV2Builder = void 0;
var BillableComplexityEngine_1 = require("../../engine/scoring/BillableComplexityEngine");
var RiskDecisionEngine_1 = require("../../engine/RiskDecisionEngine");
var ExecutiveRiskReportV2Builder = /** @class */ (function () {
    function ExecutiveRiskReportV2Builder() {
    }
    ExecutiveRiskReportV2Builder.build = function (summary, assessmentName, assessmentDate) {
        if (assessmentName === void 0) { assessmentName = "Enterprise Risk Assessment"; }
        if (assessmentDate === void 0) { assessmentDate = new Date().toISOString().slice(0, 10); }
        var decision = RiskDecisionEngine_1.RiskDecisionEngine.generate(summary);
        var billable = BillableComplexityEngine_1.BillableComplexityEngine.calculate(summary);
        var pricingTable = {
            Standard: 4800,
            Professional: 12000,
            Enterprise: 25000
        };
        return Object.freeze({
            assessment: {
                name: assessmentName,
                date: assessmentDate
            },
            summary: summary,
            decision: decision,
            executiveNarrative: "This assessment reflects enterprise risk exposure based on severity, " +
                "domain concentration, governance impact, and remediation complexity.",
            remediationPlan: {
                items: decision.remediationPlan,
                advisoryNote: "Remediation priorities should focus on high-impact domains and governance gaps."
            },
            pricing: {
                tier: billable.pricingTier,
                estimatedAnnualCost: pricingTable[billable.pricingTier],
                rationale: billable.rationale
            }
        });
    };
    return ExecutiveRiskReportV2Builder;
}());
exports.ExecutiveRiskReportV2Builder = ExecutiveRiskReportV2Builder;
