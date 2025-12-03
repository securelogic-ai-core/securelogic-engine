export interface ScoredControl {
  controlId: string;
  title: string;
  domain: string;
  impact: number;
  likelihood: number;
  risk: number;
  score: number;
}

export interface ScoringResult {
  scored: ScoredControl[];
  highestRisk: number;
  averageRisk: number;
}
