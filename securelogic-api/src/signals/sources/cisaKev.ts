import { Signal } from "../contract/Signal.js";
import { SignalStatus } from "../contract/SignalStatus.js";

export async function ingestCisaKev(): Promise<Signal[]> {
  return [
    {
      id: "CISA-KEV-TEST-001",
      source: "CISA_KEV",
      title: "Test KEV Entry",
      publishedAt: new Date().toISOString(),
      status: SignalStatus.RAW,
      metadata: {}
    }
  ];
}
