import { CanonicalControl } from "./Control";

export interface ScoredControl {
  controlId: string;
  title: string;
  impact: number;
  likelihood: number;
  risk: number;
  score: number;
  priority: number;
  control: CanonicalControl;
}

export interface ScoringResult {
  scored: ScoredControl[];
  highestRisk: number;
  averageRisk: number;
}
