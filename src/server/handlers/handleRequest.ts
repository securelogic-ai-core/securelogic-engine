import { RunnerEngine } from "../../engine/RunnerEngine";
import { runEngine } from "../../runEngine";
import type { ScoringInput } from "../../engine/contracts/ScoringInput";

export function handleRequest(input: ScoringInput) {
  return RunnerEngine.run(input);
}
