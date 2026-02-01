import { ScoredSignal } from "../contract/ScoredSignal.js";
import { FilterPolicy } from "./FilterPolicy.js";

const bandRank = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4
} as const;

export function applyFilter(
  signals: ScoredSignal[],
  policy: FilterPolicy
): ScoredSignal[] {
  return signals.filter(
    s => bandRank[s.risk.band] >= bandRank[policy.minRiskBand]
  );
}
