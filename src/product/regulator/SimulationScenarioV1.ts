export interface SimulationScenarioV1 {
  scenarioId: string;
  description: string;
  injectedFailure: "DATA_LEAK" | "KEY_COMPROMISE" | "POLICY_BYPASS";
  executedAt: string;
}
