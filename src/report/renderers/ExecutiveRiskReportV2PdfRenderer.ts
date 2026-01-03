import type { ExecutiveRiskReportV2 } from "../contracts/ExecutiveRiskReportV2.js";

export class ExecutiveRiskReportV2PdfRenderer {
  static render(report: ExecutiveRiskReportV2): string {
    return `
EXECUTIVE RISK REPORT
====================

Assessment: ${report.assessment.name}
Date: ${report.assessment.date}

RISK DECISION
-------------
Level: ${report.decision.level}
Approval Status: ${report.decision.approvalStatus}

EXECUTIVE SUMMARY
-----------------
${report.executiveNarrative}

REMEDIATION PLAN
----------------
${report.remediationPlan.items
  .map(i => `- ${i.description} (Priority: ${i.priority})`)
  .join("\n")}

${
  report.pricing
    ? `
PRICING
-------
Tier: ${report.pricing.tier}
Estimated Annual Cost: $${report.pricing.estimatedAnnualCost}
`
    : ""
}
`.trim();
  }
}
