import { ScoredSignal } from "../../contract/ScoredSignal.js";
import { SignalOutput } from "../SignalOutput.js";

export function formatNewsletterSignal(
  signal: ScoredSignal
): SignalOutput {
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
