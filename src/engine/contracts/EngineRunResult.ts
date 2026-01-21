export type EngineRunResult = {
  version: "1.0";
  timestamp: string;
  decision: {
    severity: "Low" | "Moderate" | "High" | "Critical";
  };
  ledgerEntryHash: string;
};
