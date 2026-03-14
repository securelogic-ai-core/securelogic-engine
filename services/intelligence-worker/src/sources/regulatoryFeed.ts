export async function fetchRegulatorySignals() {
  return [
    {
      eventType: "signal.ingested",
      signalId: "SIG-REG-001",
      source: "regulatory_feed",
      title: "EU AI Act implementation guidance released",
      timestamp: new Date().toISOString(),
      payload:
        "European regulators released additional implementation guidance for high-risk AI systems."
    }
  ];
}