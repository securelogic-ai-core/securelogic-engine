import { DedupedSignal } from "./DedupedSignal.js";
import { RiskScore } from "./RiskScore.js";

export interface ScoredSignal extends DedupedSignal {
  risk: RiskScore;
}
