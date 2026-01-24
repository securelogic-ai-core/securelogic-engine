import type { FrameworkRunner, FrameworkResult } from "./FrameworkRunner.js";
import type { EngineInput } from "../contracts/EngineInput.js";
import type { Clock } from "../runtime/Clock.js";

import { ControlEvaluationEngine } from "../evaluation/ControlEvaluationEngine.js";
import { FindingGenerator } from "../adapters/FindingGenerator.js";

export class NISTFramework implements FrameworkRunner {
  name = "NIST";

  async run(input: EngineInput, clock: Clock): Promise<FrameworkResult> {
    const controlResults = ControlEvaluationEngine.evaluate(input.answers);

    const findings = FindingGenerator.fromControlResults(controlResults, clock);

    return {
      framework: this.name,
      findings
    };
  }
}
