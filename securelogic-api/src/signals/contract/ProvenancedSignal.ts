import { ScoredSignal } from "./ScoredSignal";
import { Provenance } from "./Provenance";

export interface ProvenancedSignal extends ScoredSignal {
  provenance: Provenance;
}
