import { ScoringEngine } from "./ScoringEngine";
import { buildEngineResult } from "../../engine/adapters/EngineResultBuilder";
import { ScoringInput } from "../../engine/contracts/ScoringInput";

export class RunnerEngine {
  static run(input: ScoringInput) {
    const findings = ScoringEngine.score(input);
    return buildEngineResult(findings);
  }
}
