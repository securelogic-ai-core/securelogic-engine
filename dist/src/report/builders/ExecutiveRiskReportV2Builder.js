"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutiveRiskReportV2Builder = void 0;
const BillableComplexityEngine_1 = require("../../engine/scoring/BillableComplexityEngine");
const RiskDecisionEngine_1 = require("../../engine/RiskDecisionEngine");
class ExecutiveRiskReportV2Builder {
    static build(summary, assessmentName = "Enterprise Risk Assessment", assessmentDate = new Date().toISOString().slice(0, 10)) {
        const decision = RiskDecisionEngine_1.RiskDecisionEngine.generate(summary);
        const billable = BillableComplexityEngine_1.BillableComplexityEngine.calculate(summary);
        const pricingTable = {
            Standard: 4800,
            Professional: 12000,
            Enterprise: 25000
        };
        return Object.freeze({
            assessment: {
                name: assessmentName,
                date: assessmentDate
            },
            summary,
            decision,
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
    }
}
exports.ExecutiveRiskReportV2Builder = ExecutiveRiskReportV2Builder;
