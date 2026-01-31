import { ScoredSignal } from "../contract/ScoredSignal.js";
import { ProvenancedSignal } from "../contract/ProvenancedSignal.js";
import { ENGINE_VERSION } from "../engineVersion.js";

export function attachProvenance(signal: ScoredSignal): ProvenancedSignal {
  const now = new Date().toISOString();
  return {
    ...signal,
    provenance: {
      sourceSystem: signal.source,
      ingestedAt: now,
      qualifiedAt: now,
      normalizedAt: now,
      scoredAt: now,
      engineVersion: ENGINE_VERSION
    }
  };
}
