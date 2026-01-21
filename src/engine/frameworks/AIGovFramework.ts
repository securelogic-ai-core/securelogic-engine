import type { FrameworkRunner, FrameworkResult } from "./FrameworkRunner.js";
import type { EngineInput } from "../RunnerEngine.js";

import { ControlEvaluationEngine } from "../evaluation/ControlEvaluationEngine.js";
import { FindingGenerator } from "../adapters/FindingGenerator.js";

export class AIGovFramework implements FrameworkRunner {
  name = "AI-Governance";

  async run(input: EngineInput): Promise<FrameworkResult> {
    const controlResults = ControlEvaluationEngine.evaluate(input.answers);

    const findings = FindingGenerator.fromControlResults(controlResults);

    return {
      framework: this.name,
      findings
    };
  }
}