import { Signal } from "../contract/Signal.js";
import { NormalizedSignal } from "../contract/NormalizedSignal.js";
import { SignalStatus } from "../contract/SignalStatus.js";

export function normalizeSignal(signal: Signal): NormalizedSignal {
  return {
    ...signal,
    severity: 9,
    confidence: 0.95,
    dedupeHash: "placeholder",
    status: SignalStatus.RAW
  };
}
