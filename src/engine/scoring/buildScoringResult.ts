/**
 * INTERNAL scoring result builder.
 * Not a public contract.
 */

type RiskDomain = string;

type ScoringResult = {
  score: number;
  domains: RiskDomain[];
};

export function buildScoringResult(
  score: number,
  domains: RiskDomain[]
): ScoringResult {
  return {
    score,
    domains
  };
}
