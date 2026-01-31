import { ScoredSignal } from "./ScoredSignal.js";
import { Provenance } from "./Provenance.js";

export interface ProvenancedSignal extends ScoredSignal {
  provenance: Provenance;
}
