import { ingestCisaKev } from "./sources/cisaKev.js";
import { normalizeSignal } from "./normalize/normalizeSignal.js";
import { qualifySignal } from "./qualify/qualifySignal.js";
import { dedupeSignals } from "./dedupe/dedupeSignals.js";
import { scoreSignal } from "./score/scoreSignal.js";
import { attachProvenance } from "./provenance/attachProvenance.js";
import { ProvenancedSignal } from "./contract/ProvenancedSignal.js";

export async function runSignalPipeline(): Promise<ProvenancedSignal[]> {
  const raw = await ingestCisaKev();

  const normalized = raw.map(normalizeSignal).map(qualifySignal);
  const deduped = dedupeSignals(normalized);
  const scored = deduped.map(scoreSignal);

  return scored.map(attachProvenance);
}
