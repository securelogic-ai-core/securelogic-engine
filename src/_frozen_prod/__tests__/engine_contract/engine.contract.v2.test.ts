import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { RunnerEngine } from "../../../engine/RunnerEngine.js";

const GOLDENS_DIR = path.join(__dirname, "goldens");

function strip(obj: any) {
  const clone = structuredClone(obj);

  // Remove volatile fields
  if (clone.report?.meta) {
    delete clone.report.meta.generatedAt;
    delete clone.report.meta.ledgerHash;
  }

  return clone;
}

describe("Engine Contract V2", () => {
  it("produces the same canonical output for v2 input", async () => {
    const inputPath = path.join(GOLDENS_DIR, "input.v2.json");
    const outputPath = path.join(GOLDENS_DIR, "output.v2.json");

    const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    const expected = JSON.parse(fs.readFileSync(outputPath, "utf8"));

    const engine = new RunnerEngine(undefined, "V2");
    const actual = await engine.run(input);

    expect(strip(actual)).toEqual(strip(expected));
  });
});