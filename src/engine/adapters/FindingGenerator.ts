import type { ControlResult } from "../evaluation/ControlEvaluationEngine.js";
import type { Clock } from "../runtime/Clock.js";

const EXPLAIN_MODE = process.env.SECURELOGIC_EXPLAIN === "1";

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

      const finding: any = {
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
      };

      // Hidden explain block (does not affect prod outputs)
      if (EXPLAIN_MODE) {
        finding.__explain = {
          confidence: {
            model: "legacy-frozen",
            inputs: {
              evidenceCount,
              severity: c.severity
            },
            components: {
              strictnessFactor: strictness,
              reusePenalty: 1.0
            },
            finalScore: confidenceScore,
            note: "This is the legacy frozen confidence model. Real engine explainability will replace this."
          }
        };
      }

      findings.push(finding);
    }

    return findings;
  }
}
