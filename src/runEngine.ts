import { RunnerEngine } from "./engine/RunnerEngine";
import { ScoringInput } from "./engine/contracts/ScoringInput";

export function runEngine(input: ScoringInput) {
  console.log("🚨 USING PRIMARY RunnerEngine");
  return RunnerEngine.run(input);
}
