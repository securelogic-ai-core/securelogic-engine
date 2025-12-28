import type { ScoringOutputV1 } from "../../engine/contracts/scoring";
import type { FindingV1 } from "../contracts/finding/Finding";
import { generateFindingId } from "../finding/generateFindingId";

/**
 * Builds traceable findings from scoring output.
 * ENTERPRISE-SAFE: handles redacted or licensed outputs.
 */
export function buildFindings(
  scoring: ScoringOutputV1
): FindingV1[] {
  const domainScores = scoring.domainScores ?? [];

  return domainScores
    .filter(d => d.score > 0)
    .map(d => {
      const severity =
        d.score >= 80
          ? "Critical"
          : d.score >= 60
          ? "High"
          : d.score >= 30
          ? "Medium"
          : "Low";

      const id = generateFindingId(d.domain, severity);

      return {
        id,
        title: `Control weakness in ${d.domain}`,
        description: `Controls in ${d.domain} are not operating effectively.`,
        severity,
        lineage: {
          findingId: id,
          controlId: d.domain,
          controlDomain: d.domain,
          scoringSource: "engine",
          evidenceIds: [],
          derivedAt: new Date().toISOString()
        }
      };
    });
}