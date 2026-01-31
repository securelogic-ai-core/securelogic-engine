import { ScoredSignal } from "../contract/ScoredSignal";

export interface SignalOutput {
  id: string;
  headline: string;
  summary: string;
  riskBand: ScoredSignal["risk"]["band"];
  score: number;
  publishedAt: string;
  source: string;
}
