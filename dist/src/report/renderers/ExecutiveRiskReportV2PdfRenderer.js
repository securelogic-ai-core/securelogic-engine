"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutiveRiskReportV2PdfRenderer = void 0;
class ExecutiveRiskReportV2PdfRenderer {
    static render(report) {
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

${report.pricing
            ? `
PRICING
-------
Tier: ${report.pricing.tier}
Estimated Annual Cost: $${report.pricing.estimatedAnnualCost}
`
            : ""}
`.trim();
    }
}
exports.ExecutiveRiskReportV2PdfRenderer = ExecutiveRiskReportV2PdfRenderer;
