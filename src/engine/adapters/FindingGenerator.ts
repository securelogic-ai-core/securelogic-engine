import type { ControlResult } from "../evaluation/ControlEvaluationEngine.js";
import type { Finding, EvidenceItem, ConfidenceLevel } from "../../reporting/ReportSchema.js";

export class FindingGenerator {
  static fromControlResults(results: ControlResult[]): Finding[] {
    return results
      .filter(r => !r.passed)
      .map(r => {
        const evidenceItems: EvidenceItem[] = [
          {
            source: "Questionnaire",
            reference: r.control.id,
            note: "Marked as not implemented in assessment response"
          }
        ];

        // Simple deterministic confidence rule for now (enterprise-safe default)
        const confidence: ConfidenceLevel = "High";

        return {
          id: r.control.id,
          title: r.control.title,
          severity: r.control.severity,
          domain: r.control.domain,

          // 🔴 MULTI-FRAMEWORK ATTRIBUTION
          mappedFrameworks: Object.keys(r.control.frameworks ?? {}),

          // 🔴 AUDIT EVIDENCE
          evidenceItems,

          // 🔴 CONFIDENCE
          confidence,

          businessImpact: "Increased regulatory and operational risk.",
          evidence: "Control evaluated as not implemented.",
          recommendation: "Implement and formalize this control."
        };
      });
  }
}