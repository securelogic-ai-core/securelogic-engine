import { NormalizedSignal } from "../contract/NormalizedSignal.js";
import { SignalStatus } from "../contract/SignalStatus.js";

export function qualifySignal(signal: NormalizedSignal): NormalizedSignal {
  if (signal.severity < 5) {
    return { ...signal, status: SignalStatus.DISCARDED };
  }
  return { ...signal, status: SignalStatus.QUALIFIED };
}
