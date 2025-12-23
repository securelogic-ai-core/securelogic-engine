import type { ScoringInput } from "../contracts/ScoringInput";
import type { ScoringOutputV1, DomainScore } from "../contracts/scoring";

import { scoreControlState } from "./scoreControlState";

export function runScoring(input: ScoringInput): ScoringOutputV1 {
  const overallRiskScore = scoreControlState(input.controlState);

  const domainScores: DomainScore[] = Object.entries(input.controlState).map(
    ([domain, state]) => ({
      domain,
      score: state ? 0 : 100
    })
  );

  return {
    version: "scoring-output-v1",
    overallRiskScore,
    domainScores,
    orgProfile: {
      industry: input.orgProfile.industry,
      size: input.orgProfile.size
    },
    generatedAt: new Date().toISOString()
  };
}
