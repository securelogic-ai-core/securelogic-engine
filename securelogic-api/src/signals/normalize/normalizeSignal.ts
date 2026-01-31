import crypto from "crypto";
import { Signal } from "../contract/Signal";
import { NormalizedSignal } from "../contract/NormalizedSignal";

function computeSeverity(signal: Signal): number {
  if (signal.source === "CISA_KEV") return 9;
  return 5;
}

function computeConfidence(signal: Signal): number {
  if (signal.source === "CISA_KEV") return 0.95;
  return 0.6;
}

function computeDedupeHash(signal: Signal): string {
  return crypto
    .createHash("sha256")
    .update(`${signal.source}:${signal.title}`)
    .digest("hex");
}

export function normalizeSignal(signal: Signal): NormalizedSignal {
  return {
    ...signal,
    severity: computeSeverity(signal),
    confidence: computeConfidence(signal),
    dedupeHash: computeDedupeHash(signal)
  };
}
