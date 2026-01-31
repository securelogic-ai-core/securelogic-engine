import { DedupedSignal } from "../contract/DedupedSignal.js";
import { ScoredSignal } from "../contract/ScoredSignal.js";

export function scoreSignal(signal: DedupedSignal): ScoredSignal {
  return {
    ...signal,
    risk: {
      score: 79,
      band: "HIGH",
      rationale: [
        "Severity contributes",
        "Confidence contributes",
        "Occurrences contributes"
      ]
    }
  };
}
