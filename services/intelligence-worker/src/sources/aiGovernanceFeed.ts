export async function fetchAIGovernanceSignals() {
  return [
    {
      eventType: "signal.ingested",
      signalId: "SIG-AI-001",
      source: "ai_governance",
      title: "New open-source AI model raises governance questions",
      timestamp: new Date().toISOString(),
      payload:
        "A new open-source AI model release is prompting discussions about governance controls."
    }
  ];
}