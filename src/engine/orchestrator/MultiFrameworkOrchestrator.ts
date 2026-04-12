import type { FrameworkRunner } from "../frameworks/FrameworkRunner.js";
import type { EngineInput } from "../contracts/EngineInput.js";
import type { Clock } from "../runtime/Clock.js";
import { type EngineLogger, noopLogger } from "../EngineLogger.js";

export class EngineFrameworkError extends Error {
  constructor(
    public readonly framework: string,
    public readonly cause: unknown
  ) {
    super(`Framework execution failed: ${framework}`);
    this.name = "EngineFrameworkError";
  }
}

export class MultiFrameworkOrchestrator {
  constructor(
    private readonly frameworks: FrameworkRunner[],
    private readonly logger: EngineLogger = noopLogger
  ) {}

  async runAll(input: EngineInput, clock: Clock) {
    const results = [];
    for (const fw of this.frameworks) {
      const start = Date.now();
      try {
        results.push(await fw.run(input, clock));
      } catch (err) {
        this.logger.error(
          {
            event: "engine_framework_failed",
            framework: fw.name,
            elapsedMs: Date.now() - start,
            err,
          },
          `Engine framework failed: ${fw.name}`
        );
        throw new EngineFrameworkError(fw.name, err);
      }
    }
    return results;
  }
}
