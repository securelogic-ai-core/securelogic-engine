import type { FrameworkRunner } from "../frameworks/FrameworkRunner.js";
import type { EngineInput } from "../contracts/EngineInput.js";
import type { Clock } from "../runtime/Clock.js";

export class MultiFrameworkOrchestrator {
  constructor(private readonly frameworks: FrameworkRunner[]) {}

  async runAll(input: EngineInput, clock: Clock) {
    const results = [];
    for (const fw of this.frameworks) {
      results.push(await fw.run(input, clock));
    }
    return results;
  }
}
