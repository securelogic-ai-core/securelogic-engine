import { RunnerEngine } from "./engine/RunnerEngine.js";
import type { ScoringInput } from "./engine/contracts/ScoringInput.js";

export function runEngine(input: ScoringInput) {
  console.log("🚨 USING PRIMARY RunnerEngine");
  return RunnerEngine.run(input);
}
