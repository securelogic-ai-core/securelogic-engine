import { ScoredSignal } from "../contract/ScoredSignal.js";

export interface SignalOutput {
  id: string;
  headline: string;
  summary: string;
  riskBand: ScoredSignal["risk"]["band"];
  score: number;
  publishedAt: string;
  source: string;
}
