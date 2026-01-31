import { DedupedSignal } from "./DedupedSignal";
import { RiskScore } from "./RiskScore";

export interface ScoredSignal extends DedupedSignal {
  risk: RiskScore;
}
