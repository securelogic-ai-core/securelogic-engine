import { SignalStatus } from "../contract/SignalStatus";
import { Signal } from "../contract/Signal";

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
