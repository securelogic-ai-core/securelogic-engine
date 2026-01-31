import { Signal } from "./Signal.js";
import { SignalStatus } from "./SignalStatus.js";

export interface NormalizedSignal extends Signal {
  severity: number;
  confidence: number;
  dedupeHash: string;
  status: SignalStatus;
}
