/**
 * ApplicabilityEngineV1.golden.test.ts — corpus change-audit gate (AD-7-support).
 *
 * Each case is an `<name>.input.json` + a locked `<name>.expected.json` under
 * ./golden/cases. The engine runs each input and must deep-equal the locked
 * expected output. Any edit to the rule corpus that MOVES a golden output is a
 * deliberate act: it must ship with the regenerated expected fixture AND an
 * `engine_version` bump, both visible in the PR diff. That review IS the change
 * audit — no DB-backed rule-governance table is needed at this slice.
 *
 * Regenerate (after an intentional corpus change) with:
 *   node --import tsx src/engine/applicability/v1/__tests__/regenerateGolden.ts
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ApplicabilityEngineV1 } from "../ApplicabilityEngineV1.js";
import type { ApplicabilityInput } from "../types.js";

const casesDir = fileURLToPath(new URL("./golden/cases/", import.meta.url));

const inputs = readdirSync(casesDir).filter((f) => f.endsWith(".input.json")).sort();

describe("ApplicabilityEngineV1 — golden regression", () => {
  it("has golden cases", () => {
    expect(inputs.length).toBeGreaterThan(0);
  });

  for (const inputFile of inputs) {
    const name = inputFile.replace(/\.input\.json$/, "");
    it(`golden: ${name}`, () => {
      const input = JSON.parse(readFileSync(casesDir + inputFile, "utf8")) as ApplicabilityInput;
      const expected = JSON.parse(readFileSync(casesDir + `${name}.expected.json`, "utf8"));
      const actual = ApplicabilityEngineV1.assess(input);
      expect(actual).toEqual(expected);
    });
  }
});
