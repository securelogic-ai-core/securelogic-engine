import { ExecutiveRiskReportV2 } from "../contracts/ExecutiveRiskReportV2";
import { EnterpriseRiskSummary } from "../../engine/contracts/EnterpriseRiskSummary";
import { BillableComplexityEngine } from "../../engine/scoring/BillableComplexityEngine";
import { RiskDecisionEngine } from "../../engine/RiskDecisionEngine";

export class ExecutiveRiskReportV2Builder {
  static build(
    summary: EnterpriseRiskSummary,
    assessmentName = "Enterprise Risk Assessment",
    assessmentDate = new Date().toISOString().slice(0, 10)
  ): ExecutiveRiskReportV2 {
    const decision = RiskDecisionEngine.generate(summary);
    const billable = BillableComplexityEngine.calculate(summary);

    const pricingTable: Record<
      typeof billable.pricingTier,
      number
    > = {
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

      executiveNarrative:
        "This assessment reflects enterprise risk exposure based on severity, " +
        "domain concentration, governance impact, and remediation complexity.",

      remediationPlan: {
        items: decision.remediationPlan,
        advisoryNote:
          "Remediation priorities should focus on high-impact domains and governance gaps."
      },

      pricing: {
        tier: billable.pricingTier,
        estimatedAnnualCost: pricingTable[billable.pricingTier],
        rationale: billable.rationale
      }
    });
  }
}
