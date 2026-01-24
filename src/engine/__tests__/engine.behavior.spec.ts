import { describe, it, expect } from "vitest";
import { RunnerEngine } from "../RunnerEngine.js";
import type { EngineInput } from "../contracts/EngineInput.js";

function baseInput(): EngineInput {
  return {
    client: {
      name: "TestCo",
      industry: "Tech",
      assessmentType: "AI",
      scope: "Full"
    },
    context: {
      regulated: true,
      safetyCritical: false,
      handlesPII: true,
      scale: "Enterprise"
    },
    answers: {
      "CTRL-1": true,
      "CTRL-2": false,
      "CTRL-3": false
    }
  };
}

describe("Engine Behavior Lock", () => {

  it("is deterministic for identical input", async () => {
    const engine = new RunnerEngine();

    const input = baseInput();

    const r1 = await engine.run(input);
    const r2 = await engine.run(input);

    expect(r1.decision).toEqual(r2.decision);
  });

  it("does not leak state between runs", async () => {
    const engine = new RunnerEngine();

    const input = baseInput();

    const r1 = await engine.run(input);
    const r2 = await engine.run(input);

    expect(r1.decision).toEqual(r2.decision);
  });

});
