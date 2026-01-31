import { ScoredSignal } from "../contract/ScoredSignal";
import { ProvenancedSignal } from "../contract/ProvenancedSignal";
import { ENGINE_VERSION } from "../engineVersion";

export function attachProvenance(
  signal: ScoredSignal
): ProvenancedSignal {
  const now = new Date().toISOString();

  return {
    ...signal,
    provenance: {
      sourceSystem: signal.source,
      ingestedAt: signal.publishedAt,
      qualifiedAt: now,
      normalizedAt: now,
      scoredAt: now,
      engineVersion: ENGINE_VERSION
    }
  };
}
