import { describe, it, expect } from "vitest";

import fs from "fs";
import { describe, it, expect } from "vitest";
import { RunnerEngine } from "../../index.js";;;

describe("RiskDecision frozen contract", () => {
  it("must not change without a version bump", async () => {
    const input = JSON.parse(
      fs.readFileSync("decision-fixtures/canonical.input.json", "utf-8")
    );

    const expected = JSON.parse(
      fs.readFileSync("decision-fixtures/canonical.decision.json", "utf-8")
    );

    const engine = new RunnerEngine();
    const result = await engine.run(input);

    const actual = result.decision;

    expect(actual).toEqual(expected);
  });
});
