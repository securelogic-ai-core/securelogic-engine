import { ProvenancedSignal } from "../../signals/contract/ProvenancedSignal";
import { PublicSignal } from "../dto/PublicSignal";
import { PaidSignal } from "../dto/PaidSignal";
import { AccessTier } from "../../signals/filter/FilterPolicy";

export function mapSignalResponse(
  signal: ProvenancedSignal,
  tier: AccessTier
): PublicSignal | PaidSignal {
  if (tier === "PAID") {
    return {
      id: signal.id,
      title: signal.title,
      publishedAt: signal.publishedAt,
      source: signal.source,

      severity: signal.severity,
      confidence: signal.confidence,
      occurrences: signal.occurrences,

      risk: signal.risk,
      provenance: signal.provenance
    };
  }

  // FREE (public-safe)
  return {
    id: signal.id,
    headline: `[${signal.risk.band}] ${signal.title}`,
    summary: `Risk score ${signal.risk.score}. Source: ${signal.source}.`,
    riskBand: signal.risk.band,
    score: signal.risk.score,
    publishedAt: signal.publishedAt,
    source: signal.source
  };
}
