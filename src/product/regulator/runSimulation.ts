import type { SimulationScenarioV1 } from "./SimulationScenarioV1";

export function runSimulation(s: SimulationScenarioV1): void {
  throw new Error(`REGULATOR_SIMULATION_TRIGGERED:${s.injectedFailure}`);
}
