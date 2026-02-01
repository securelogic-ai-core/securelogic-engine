import type { Signal } from "./Signal.js";

export async function runSignalIntake(): Promise<Signal[]> {
  // TEMP: stubbed — replace with scrapers later
  return [
    {
      id: "chg-healthcare-ransomware",
      source: "Public Reporting",
      url: "https://example.com",
      title: "Healthcare billing outage",
      summary: "Claims processing disruption due to ransomware",
      domains: ["Operational Resilience", "Third-Party Risk", "Identity"],
      confidence: "HIGH",
      detectedAt: new Date().toISOString()
    }
  ];
}
