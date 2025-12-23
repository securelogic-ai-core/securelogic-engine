import { LicenseContext } from "./LicenseTier";
import { EnterpriseRiskSummary } from "../engine/contracts/EnterpriseRiskSummary";
import { RiskDecisionEngine } from "../engine/RiskDecisionEngine";
import { ExecutiveRiskReportV2Builder } from "../report/builders/ExecutiveRiskReportV2Builder";
import { LICENSE_ENTITLEMENTS } from "./contracts/LicenseEntitlements";

export class SecureLogicAI {
  static runAssessment(
    summary: EnterpriseRiskSummary,
    license: LicenseContext
  ) {
    const decision = RiskDecisionEngine.generate(summary);
    const entitlements = LICENSE_ENTITLEMENTS[license.tier];

    if (!entitlements.includesExecutiveReport) {
      return { decision };
    }

    const fullReport = ExecutiveRiskReportV2Builder.build(summary);

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
