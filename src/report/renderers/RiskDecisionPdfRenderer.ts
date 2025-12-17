import { RiskDecisionReportV1 } from "../contracts/RiskDecisionReportV1";
import { RemediationDecision } from "../../engine/contracts/RiskDecision";

export class RiskDecisionPdfRenderer {
  static render(input: RiskDecisionReportV1): string {
    const { decision, assessment } = input;

    return `
      <html>
        <body>
          <h1>Risk Decision Report</h1>

          <p><strong>Assessment Name:</strong> ${assessment.name}</p>
          <p><strong>Assessment Date:</strong> ${assessment.date}</p>

          <h2>Decision Summary</h2>
          <p><strong>Risk Level:</strong> ${decision.level}</p>
          <p><strong>Approval Status:</strong> ${decision.approvalStatus}</p>

          <h3>Severity Rationale</h3>
          <ul>
            ${(decision.severityRationale ?? [])
              .map((r: string) => `<li>${r}</li>`)
              .join("")}
          </ul>

          <h3>Remediation Plan</h3>
          <ul>
            ${(decision.remediationPlan ?? [])
              .map(
                (r: RemediationDecision) =>
                  `<li>${r.description} (Priority: ${r.priority})</li>`
              )
              .join("")}
          </ul>
        </body>
      </html>
    `;
  }
}
