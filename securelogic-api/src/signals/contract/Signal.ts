import { SignalStatus } from "./SignalStatus.js";

export type SignalSource = "CISA_KEV" | "NVD";

export interface Signal {
  id: string;
  source: SignalSource;
  title: string;
  publishedAt: string;
  status: SignalStatus;
  metadata?: Record<string, unknown>;
}
