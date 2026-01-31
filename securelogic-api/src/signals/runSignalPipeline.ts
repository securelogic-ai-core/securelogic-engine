import { ingestCisaKev } from "./sources/cisaKev";
import { qualifySignal } from "./qualify/qualifySignal";
import { normalizeSignal } from "./normalize/normalizeSignal";
import { dedupeSignals } from "./dedupe/dedupeSignals";
import { scoreSignal } from "./score/scoreSignal";
import { attachProvenance } from "./provenance/attachProvenance";
import { ProvenancedSignal } from "./contract/ProvenancedSignal";

export async function runSignalPipeline(): Promise<ProvenancedSignal[]> {
  const rawSignals = await ingestCisaKev();

  const qualified = rawSignals
    .map(qualifySignal)
    .filter(s => s.status === "QUALIFIED");

  const normalized = qualified.map(normalizeSignal);

  const deduped = dedupeSignals(normalized);

  const scored = deduped.map(scoreSignal);

  return scored.map(attachProvenance);
}