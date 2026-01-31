import { NormalizedSignal } from "./NormalizedSignal";

export interface DedupedSignal extends NormalizedSignal {
  occurrences: number;
}
