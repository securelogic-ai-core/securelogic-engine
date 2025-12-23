import type { ScoringOutputV1 } from "../../engine/contracts/scoring";
import type { FindingV1 } from "../contracts/finding/Finding";
import type { ControlTraceV1 } from "../contracts/control/ControlTrace";

/**
 * Builds deterministic control traces from scoring + findings.
 */
export function buildControlTraces(
  scoring: ScoringOutputV1,
  findings: FindingV1[]
): ControlTraceV1[] {
  const domainScores = scoring.domainScores ?? [];

  return domainScores.map(domainScore => {
    const relatedFindings = findings.filter(
      f => f.lineage.controlDomain === domainScore.domain
    );

    const outcome =
      domainScore.score >= 80
        ? "Fail"
        : domainScore.score >= 30
        ? "Partial"
        : "Pass";

    return {
      controlId: domainScore.domain,
      domain: domainScore.domain,
      evaluatedAt: new Date().toISOString(),
      score: domainScore.score,
      outcome,
      findingIds: relatedFindings.map(f => f.id),
      evidenceIds: []
    };
  });
}
