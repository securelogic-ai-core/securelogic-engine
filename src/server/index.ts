import { runEngine } from "../runEngine";
import { ScoringInput } from "../engine/contracts/ScoringInput";

export function handleRequest(scoringInput: ScoringInput) {
  return runEngine(scoringInput);
}
