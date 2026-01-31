import { ScoredSignal } from "../contract/ScoredSignal";
import { FilterPolicy } from "./FilterPolicy";

const bandRank: Record<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL", number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4
};

export function applyFilter(
  signals: ScoredSignal[],
  policy: FilterPolicy
): ScoredSignal[] {
  const filtered = signals.filter(
    s => bandRank[s.risk.band] >= bandRank[policy.minRiskBand]
  );

  if (policy.maxItems !== undefined) {
    return filtered.slice(0, policy.maxItems);
  }

  return filtered;
}