import { SignalStatus } from "./SignalStatus";
import { SignalSource } from "./Signal";

export interface NormalizedSignal {
  id: string;
  source: SignalSource;
  title: string;
  publishedAt: string;
  status: SignalStatus;

  severity: number;      // 1–10
  confidence: number;    // 0–1
  dedupeHash: string;

  metadata: Record<string, unknown>;
}
