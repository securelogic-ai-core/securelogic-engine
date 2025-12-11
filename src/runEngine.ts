import { RunnerEngine } from "./engines/v2/RunnerEngine";
import { ScoringInput } from "./engine/contracts/ScoringInput";

export function runEngine(input: ScoringInput) {
  return RunnerEngine.run(input);
}
