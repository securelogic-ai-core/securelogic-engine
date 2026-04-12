import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { RunnerEngine } from "../../../engine/RunnerEngine.js";

const GOLDENS = path.join(__dirname, "goldens");

function readJson(name: string) {
  return JSON.parse(fs.readFileSync(path.join(GOLDENS, name), "utf-8"));
}

describe("Engine severity boundary regression", () => {
  it("all controls passing must produce Low severity", async () => {
    const input = readJson("input.all-pass.json");
    const expected = readJson("decision.all-pass.json");

    const engine = new RunnerEngine();
    const { decision } = await engine.run(input);

    expect(decision).toEqual(expected);
  });

  it("single Moderate-severity control failing with minimal context must produce Moderate severity", async () => {
    const input = readJson("input.low-context-moderate.json");
    const expected = readJson("decision.low-context-moderate.json");

    const engine = new RunnerEngine();
    const { decision } = await engine.run(input);

    expect(decision).toEqual(expected);
  });

  it("all controls failing with maximum context must produce Critical severity", async () => {
    const input = readJson("input.max-risk-critical.json");
    const expected = readJson("decision.max-risk-critical.json");

    const engine = new RunnerEngine();
    const { decision } = await engine.run(input);

    expect(decision).toEqual(expected);
  });
});
