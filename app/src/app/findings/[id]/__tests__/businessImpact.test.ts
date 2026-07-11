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

  it("considers every dimension it is given, whichever one carries the impact", () => {
    // Was a five-element case ("revenue/customer are no longer ignored"). Zone C
    // now renders three dimensions — revenue and customer were removed as
    // unsourceable placeholders — but the function stays arity-agnostic: it is a
    // pure function of exactly the rows rendered beneath it, however many those are.
    expect(topBusinessImpact(["high", "none", "none"])).toBe("high");
    expect(topBusinessImpact(["none", "medium", "none"])).toBe("medium");
    expect(topBusinessImpact(["none", "none", "low"])).toBe("low");
  });

  it("all-assessed-and-none reads 'none', not 'not_assessed'", () => {
    // The bug that removing revenue/customer incidentally fixed. Those two were
    // ALWAYS "not_assessed", so the not_assessed branch always won whenever the
    // three real dimensions were all "none" — a finding we HAD fully assessed, and
    // honestly found no impact for, still displayed "Business impact: Not assessed".
    expect(topBusinessImpact(["none", "none", "none"])).toBe("none");
    // The old five-dimension shape, for contrast: the two placeholders poisoned it.
    expect(topBusinessImpact(["none", "none", "none", "not_assessed", "not_assessed"])).toBe(
      "not_assessed"
    );
  });

  it("treats unrecognized/legacy level strings as unknown, never as a real impact", () => {
    expect(topBusinessImpact(["", "bogus", "none", "none", "none"])).toBe("not_assessed");
  });

  it("handles an empty dimension set defensively (nothing known → none)", () => {
    expect(topBusinessImpact([])).toBe("none");
  });
});
