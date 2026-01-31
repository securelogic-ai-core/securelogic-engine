import { ProvenancedSignal } from "../../signals/contract/ProvenancedSignal";
import { PublicSignal } from "../dto/PublicSignal";
import { AccessTier } from "../../signals/filter/FilterPolicy";

export function mapToPublicSignal(
  signal: ProvenancedSignal,
  tier: AccessTier
): PublicSignal | ProvenancedSignal {
  if (tier === "PAID") {
    return signal;
  }

  return {
    id: signal.id,
    headline: `[${signal.risk.band}] ${signal.title}`,
    riskBand: signal.risk.band,
    score: signal.risk.score,
    publishedAt: signal.publishedAt,
    source: signal.source
  };
}
