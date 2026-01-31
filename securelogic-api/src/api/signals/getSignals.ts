import { runSignalPipeline } from "../../signals/runSignalPipeline.js";
import { mapToPublicSignal } from "./mapToPublicSignal.js";
import { AccessTier } from "../../signals/filter/FilterPolicy.js";

export async function getSignals(tier: AccessTier) {
  const signals = await runSignalPipeline();
  return signals.map(signal =>
    mapToPublicSignal(signal, tier)
  );
}
