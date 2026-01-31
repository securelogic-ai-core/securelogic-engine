import { NormalizedSignal } from "../contract/NormalizedSignal";
import { DedupedSignal } from "../contract/DedupedSignal";

export function dedupeSignals(
  signals: NormalizedSignal[]
): DedupedSignal[] {
  const map = new Map<string, DedupedSignal>();

  for (const signal of signals) {
    const existing = map.get(signal.dedupeHash);

    if (existing) {
      existing.occurrences += 1;
      continue;
    }

    map.set(signal.dedupeHash, {
      ...signal,
      occurrences: 1
    });
  }

  return Array.from(map.values());
}
