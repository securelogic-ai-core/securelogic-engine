import type { ScoringOutputV1 } from "../../engine/contracts/scoring";
import type { FindingV1 } from "../contracts/finding";

/**
 * Deterministic Findings Builder
 * Converts scoring signals into normalized findings.
 */
export function buildFindings(
  scoring: ScoringOutputV1
): FindingV1[] {
  const findings: FindingV1[] = [];

  for (const domainScore of scoring.domainScores ?? []) {
    if (domainScore.score <= 20) continue;

    findings.push({
      id: `F-${domainScore.domain}`,
      severity:
        domainScore.score >= 80
          ? "Critical"
          : domainScore.score >= 60
          ? "High"
          : "Medium",

      domain: domainScore.domain,
      controlId: `${domainScore.domain}-CONTROL-001`,

      title: `Control weakness detected in ${domainScore.domain}`,
      description: `One or more controls in ${domainScore.domain} failed to meet expected criteria.`,

      evidenceIds: [],
      detectedAt: new Date().toISOString()
    });
  }

  return findings;
}
