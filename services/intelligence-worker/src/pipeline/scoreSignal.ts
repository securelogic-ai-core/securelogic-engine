import { Signal, ScoredSignal } from "../models/Signal.js";

export function scoreSignal(signal: Signal): ScoredSignal {
  const impactScore = 3;
  const noveltyScore = 4;
  const relevanceScore = 4;

  const priority =
    (impactScore + noveltyScore + relevanceScore) / 3;

  return {
    ...signal,
    impactScore,
    noveltyScore,
    relevanceScore,
    priority
  };
}