import type { ControlResult } from "../evaluation/ControlEvaluationEngine.js";
import type { Clock } from "../runtime/Clock.js";

export class FindingGenerator {
  static fromControlResults(results: ControlResult[], clock: Clock) {
    const findings: any[] = [];

    for (const r of results) {
      if (r.passed === true) continue;

      const c = r.control;

      // Legacy confidence model (frozen prod compatible)
      let confidenceScore = 26;
      let strictness = 0.85;

      if (c.severity === "Moderate") {
        confidenceScore = 28;
        strictness = 0.92;
      }

      const evidenceCount = 1;

      const confidenceRationale =
        `Based on ${evidenceCount} evidence item(s), trust-weighted model, severity ${c.severity}, ` +
        `strictness x${strictness.toFixed(2)}, reusePenalty x1.00`;

      findings.push({
        id: c.id,
        title: c.title,
        domain: c.domain,
        severity: c.severity,

        businessImpact: "Increased regulatory and operational risk.",
        recommendation: "Implement and formalize this control.",

        confidence: "Low",
        confidenceScore,
        confidenceRationale,

        evidence: "Control evaluated as not implemented.",
        evidenceItems: [
          {
            artifactType: "Other",
            source: "Questionnaire",
            provider: "Internal",
            trustLevel: "SelfAttested",
            reviewStatus: "Draft",
            reference: c.id,
            coversControls: [c.id],
            note: "Marked as not implemented in assessment response"
          }
        ],

        mappedFrameworks: c.frameworks ? Object.keys(c.frameworks) : []
      });
    }

    return findings;
  }
}