export type DomainScore = {
  domain: string;
  score: number;
};

export type ScoringInput = {
  controlState: Record<string, Record<string, boolean>>;
};

export type ScoringOutputV1 = {
  domainScores: DomainScore[];
  generatedAt: string;
};

export function runScoring(input: ScoringInput): ScoringOutputV1 {
  const domainScores: DomainScore[] = Object.entries(input.controlState).map(
    ([domain, controls]) => ({
      domain,
      score: Object.values(controls).filter(v => v === true).length
    })
  );

  return {
    domainScores,
    generatedAt: new Date().toISOString()
  };
}
