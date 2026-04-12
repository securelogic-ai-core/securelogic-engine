import { describe, it, expect } from "vitest";
import { RunnerEngine } from "../RunnerEngine.js";
import { MultiFrameworkOrchestrator, EngineFrameworkError } from "../orchestrator/MultiFrameworkOrchestrator.js";
import type { EngineLogger } from "../EngineLogger.js";
import type { EngineInput } from "../contracts/EngineInput.js";
import type { FrameworkRunner, FrameworkResult } from "../frameworks/FrameworkRunner.js";
import type { Clock } from "../runtime/Clock.js";

function makeLogger() {
  const calls: { level: string; fields: Record<string, unknown>; msg: string }[] = [];
  const logger: EngineLogger = {
    info: (fields, msg) => calls.push({ level: "info", fields, msg }),
    error: (fields, msg) => calls.push({ level: "error", fields, msg }),
    warn: (fields, msg) => calls.push({ level: "warn", fields, msg }),
  };
  return { logger, calls };
}

function baseInput(): EngineInput {
  return {
    client: {
      name: "TestCo",
      industry: "Tech",
      assessmentType: "AI",
      scope: "Full",
    },
    context: {
      regulated: true,
      safetyCritical: false,
      handlesPII: true,
      scale: "Enterprise",
    },
    answers: {
      "CTRL-1": true,
      "CTRL-2": false,
      "CTRL-3": false,
    },
  };
}

const stubClock: Clock = { now: () => new Date().toISOString() };

const failingFramework: FrameworkRunner = {
  name: "FailingFramework",
  run: async (_input: EngineInput, _clock: Clock): Promise<FrameworkResult> => {
    throw new Error("simulated framework error");
  },
};

describe("engine-observability-and-operational-guardrails", () => {
  it("successful run emits engine_run_started and engine_run_completed", async () => {
    const { logger, calls } = makeLogger();
    const engine = new RunnerEngine(undefined, undefined, logger);

    await engine.run(baseInput());

    const events = calls.map((c) => c.fields.event);
    expect(events).toContain("engine_run_started");
    expect(events).toContain("engine_run_completed");
  });

  it("engine_run_completed contains severity, findingCount, and numeric durationMs", async () => {
    const { logger, calls } = makeLogger();
    const engine = new RunnerEngine(undefined, undefined, logger);

    await engine.run(baseInput());

    const completed = calls.find((c) => c.fields.event === "engine_run_completed");
    expect(completed).toBeDefined();
    expect(typeof completed!.fields.severity).toBe("string");
    expect(typeof completed!.fields.findingCount).toBe("number");
    expect(typeof completed!.fields.durationMs).toBe("number");
  });

  it("framework failure emits engine_framework_failed and throws EngineFrameworkError", async () => {
    const { logger, calls } = makeLogger();
    const orchestrator = new MultiFrameworkOrchestrator([failingFramework], logger);

    await expect(
      orchestrator.runAll(baseInput(), stubClock)
    ).rejects.toBeInstanceOf(EngineFrameworkError);

    const errorCall = calls.find((c) => c.fields.event === "engine_framework_failed");
    expect(errorCall).toBeDefined();
    expect(errorCall!.fields.framework).toBe("FailingFramework");
    expect(typeof errorCall!.fields.elapsedMs).toBe("number");
  });

  it("engine_run_failed is emitted before rethrow when a framework throws", async () => {
    const { logger, calls } = makeLogger();
    const engine = new RunnerEngine(undefined, undefined, logger, [failingFramework]);

    await expect(engine.run(baseInput())).rejects.toBeInstanceOf(EngineFrameworkError);

    const failedCall = calls.find((c) => c.fields.event === "engine_run_failed");
    expect(failedCall).toBeDefined();
    expect(typeof failedCall!.fields.durationMs).toBe("number");
  });
});
