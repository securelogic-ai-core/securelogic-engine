import type { ControlResult } from "../evaluation/ControlEvaluationEngine.js";
import type { Finding } from "../../reporting/ReportSchema.js";

export class FindingGenerator {
  static fromControlResults(results: ControlResult[]): Finding[] {
    return results
      .filter(r => !r.passed)
      .map(r => ({
        framework: "Unified",
        id: r.control.id,
        title: r.control.title,
        severity: r.control.severity,
        domain: r.control.domain,
        businessImpact: "Increased regulatory and operational risk.",
        evidence: "Control evaluated as not implemented.",
        recommendation: "Implement and formalize this control."
      }));
  }
}
