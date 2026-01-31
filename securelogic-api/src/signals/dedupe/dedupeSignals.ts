import { NormalizedSignal } from "../contract/NormalizedSignal.js";
import { DedupedSignal } from "../contract/DedupedSignal.js";

export function dedupeSignals(
  signals: NormalizedSignal[]
): DedupedSignal[] {
  return signals.map(s => ({
    ...s,
    occurrences: 1
  }));
}
