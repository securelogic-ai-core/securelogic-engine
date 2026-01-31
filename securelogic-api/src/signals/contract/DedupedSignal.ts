import { NormalizedSignal } from "./NormalizedSignal.js";

export interface DedupedSignal extends NormalizedSignal {
  occurrences: number;
}
