import { describe, it, expect } from "vitest";

import fs from "fs";
import { describe, it, expect } from "vitest";
import { DecisionDiffEngine } from "../../../engine/explain/DecisionDiffEngine.js";

describe("DecisionDiffEngine (frozen contract)", () => {
  it("produces a stable, explainable diff between two decisions", () => {
    const before = JSON.parse(
      fs.readFileSync("diff-fixtures/before.json", "utf-8")
    );
    const after = JSON.parse(
      fs.readFileSync("diff-fixtures/after.json", "utf-8")
    );
    const expected = JSON.parse(
      fs.readFileSync("diff-fixtures/expected.diff.json", "utf-8")
    );

    const actual = DecisionDiffEngine.diff(before, after);
    expect(actual).toEqual(expected);
  });
});
