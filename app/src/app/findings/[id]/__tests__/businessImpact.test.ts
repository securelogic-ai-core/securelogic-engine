/**
 * businessImpact.test.ts — the headline Business-impact level must be a faithful
 * function of the five dimension rows, never a floor, and honest about
 * none/not_assessed (workflow-consistency Phase 2).
 */

import { describe, it, expect } from "vitest";
import { topBusinessImpact } from "../businessImpact";

describe("topBusinessImpact", () => {
  it("returns the highest KNOWN impact when one is present (known dominates unknown)", () => {
    expect(topBusinessImpact(["not_assessed", "high", "none", "not_assessed", "low"])).toBe("high");
    expect(topBusinessImpact(["none", "medium", "none", "not_assessed", "low"])).toBe("medium");
    expect(topBusinessImpact(["none", "none", "low", "not_assessed", "none"])).toBe("low");
  });

  it("does NOT floor to low — all-unassessed reads not_assessed, not Low (the core defect)", () => {
    expect(topBusinessImpact(["not_assessed", "not_assessed", "not_assessed", "not_assessed", "not_assessed"])).toBe(
      "not_assessed",
    );
  });

  it("returns none only when EVERY dimension was assessed as none", () => {
    expect(topBusinessImpact(["none", "none", "none", "none", "none"])).toBe("none");
  });

  it("prefers not_assessed over none when any dimension is still unknown (never overclaims)", () => {
    expect(topBusinessImpact(["none", "not_assessed", "none", "none", "none"])).toBe("not_assessed");
  });

  it("considers all five dimensions — revenue/customer are no longer ignored", () => {
    // Only revenue carries impact; the old 3-of-5 logic would have missed it.
    expect(topBusinessImpact(["high", "none", "none", "none", "none"])).toBe("high");
    // Only customer carries impact.
    expect(topBusinessImpact(["none", "none", "none", "medium", "none"])).toBe("medium");
  });

  it("treats unrecognized/legacy level strings as unknown, never as a real impact", () => {
    expect(topBusinessImpact(["", "bogus", "none", "none", "none"])).toBe("not_assessed");
  });

  it("handles an empty dimension set defensively (nothing known → none)", () => {
    expect(topBusinessImpact([])).toBe("none");
  });
});
