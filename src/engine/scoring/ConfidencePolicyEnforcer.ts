import type { Finding, PolicyViolation } from "../../reporting/ReportSchema.js";

type EnforcerOptions = {
  // If true, High/Critical findings with only Questionnaire evidence are Blockers
  blockOnQuestionnaireOnlyForHighRisk: boolean;

  // Minimum evidence requirement for High/Critical findings
  requireNonQuestionnaireEvidenceForHighRisk: boolean;
};

export class ConfidencePolicyEnforcer {
  static defaultOptions(): EnforcerOptions {
    return {
      blockOnQuestionnaireOnlyForHighRisk: false,
      requireNonQuestionnaireEvidenceForHighRisk: true
    };
  }

  static evaluate(findings: Finding[], opts: Partial<EnforcerOptions> = {}): PolicyViolation[] {
    const options = { ...ConfidencePolicyEnforcer.defaultOptions(), ...opts };

    const highRisk = findings.filter(f => f.severity === "High" || f.severity === "Critical");
    if (highRisk.length === 0) return [];

    const violations: PolicyViolation[] = [];

    // Rule 1: High/Critical findings cannot be based only on Questionnaire evidence
    if (options.requireNonQuestionnaireEvidenceForHighRisk) {
      const offenders = highRisk.filter(f => {
        const sources = (f.evidenceItems ?? []).map(e => (e.source ?? "").trim());
        if (sources.length === 0) return true;
        const nonQuestionnaire = sources.some(s => s && s !== "Questionnaire");
        return !nonQuestionnaire;
      });

      if (offenders.length > 0) {
        violations.push({
          code: "EVIDENCE_REQUIRED_FOR_HIGH_RISK",
          severity: options.blockOnQuestionnaireOnlyForHighRisk ? "Blocker" : "Warning",
          message:
            "High/Critical findings are supported only by questionnaire self-attestation. Add artifacts (policy, config, logs, tickets, screenshots) or downgrade confidence.",
          findingIds: offenders.map(f => f.id)
        });
      }
    }

    // Rule 2: If severity is High/Critical and confidence is Low, force a review flag
    const lowConfidenceHighRisk = highRisk.filter(f => f.confidence === "Low");
    if (lowConfidenceHighRisk.length > 0) {
      violations.push({
        code: "LOW_CONFIDENCE_HIGH_RISK_REVIEW",
        severity: "Warning",
        message:
          "High/Critical findings are low-confidence. Treat as preliminary until validated with evidence artifacts.",
        findingIds: lowConfidenceHighRisk.map(f => f.id)
      });
    }

    return violations;
  }

  // Optional: use this if you want the engine to hard fail
  static assertNoBlockers(violations: PolicyViolation[]): void {
    const blockers = violations.filter(v => v.severity === "Blocker");
    if (blockers.length > 0) {
      const msg = blockers
        .map(b => `${b.code}: ${b.message} [${b.findingIds.join(", ")}]`)
        .join(" | ");
      throw new Error(`Policy enforcement failed: ${msg}`);
    }
  }
}
