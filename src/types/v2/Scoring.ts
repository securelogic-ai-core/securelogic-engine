export interface ScoredControl {
  id: string;
  domain: string;
  title: string;
  impact: number;
  likelihood: number;
  risk: number;
}

export interface ScoringResult {
  scored: ScoredControl[];
  highestRisk: ScoredControl | null;
  averageRisk: number;
}
