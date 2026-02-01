import { ProvenancedSignal } from "../../signals/contract/ProvenancedSignal.js";
import { PaidSignal } from "../dto/PaidSignal.js";
import { PreviewSignal } from "../dto/PreviewSignal.js";
import { AccessTier } from "../../signals/filter/FilterPolicy.js";

const PREVIEW_DISCLAIMER =
  "Preview data — not licensed for operational use";

export function mapToPublicSignal(
  signal: ProvenancedSignal,
  tier: AccessTier
): PaidSignal | PreviewSignal {
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

  return {
    id: signal.id,
    headline: `[${signal.risk.band}] ${signal.title}`,
    summary: `Risk score ${signal.risk.score}. Source: ${signal.source}.`,
    riskBand: signal.risk.band,
    score: signal.risk.score,
    preview: true,
    disclaimer: PREVIEW_DISCLAIMER
  };
}
