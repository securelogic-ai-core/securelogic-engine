import { Signal } from "../contract/Signal";
import { SignalStatus } from "../contract/SignalStatus";

export async function ingestNvd(): Promise<Signal[]> {
  return [
    {
      id: "NVD-TEST-001",
      source: "NVD",
      title: "Test NVD CVE",
      publishedAt: new Date().toISOString(),
      status: SignalStatus.RAW,
      metadata: { cvss: 9.8 }
    }
  ];
}
