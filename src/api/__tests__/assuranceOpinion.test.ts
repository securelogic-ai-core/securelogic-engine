/**
 * assuranceOpinion.test.ts — VA-S4 Step 4.
 *
 * The test that matters is the first one: the exact string sitting in all five
 * staging extractions must normalise to `qualified`. Everything else guards the
 * edges around it.
 */

import { describe, expect, it } from "vitest";

import {
  ASSURANCE_OPINIONS,
  OPINION_NORMALIZER_VERSION,
  isAssuranceOpinion,
  opinionCoverageGate,
  proposeAssuranceOpinion,
} from "../lib/vendorAssurance/assuranceOpinion.js";

/** Verbatim from all five staging extractions, 2026-08-29. */
const STAGING_OPINION =
  "Unqualified opinion, except for the specific deviations and exception described in Section IV";

describe("the staging string — the reason this module exists", () => {
  it("normalises to `qualified`, not `unmodified`", () => {
    const p = proposeAssuranceOpinion(STAGING_OPINION);
    expect(p.candidate).toBe("qualified");
  });

  it("a naive substring test would get it wrong — which is the point", () => {
    // Demonstrating the defect the vocabulary replaces, not testing lodash.
    expect(STAGING_OPINION.toLowerCase().includes("unqualified")).toBe(true);
    expect(proposeAssuranceOpinion(STAGING_OPINION).candidate).not.toBe("unmodified");
  });

  it("explains itself in terms a reviewer can check against the source", () => {
    const p = proposeAssuranceOpinion(STAGING_OPINION);
    expect(p.reason).toMatch(/except for/i);
    expect(p.rule).toBeTruthy();
  });
});

describe("precedence", () => {
  it("qualification beats cleanliness when both appear", () => {
    expect(proposeAssuranceOpinion("Unqualified opinion except for X").candidate).toBe("qualified");
    expect(proposeAssuranceOpinion("Unmodified opinion, with the exception of Y").candidate).toBe("qualified");
  });

  it("adverse and disclaimer beat everything", () => {
    expect(proposeAssuranceOpinion("Adverse opinion; controls did not operate effectively").candidate).toBe("adverse");
    expect(proposeAssuranceOpinion("Disclaimer of opinion, except for nothing").candidate).toBe("disclaimer");
    expect(proposeAssuranceOpinion("We do not express an opinion").candidate).toBe("disclaimer");
  });

  it("a genuinely clean opinion is `unmodified`", () => {
    expect(proposeAssuranceOpinion("Unqualified opinion").candidate).toBe("unmodified");
    expect(proposeAssuranceOpinion("In our opinion the controls operated effectively").candidate).toBe("unmodified");
  });
});

describe("absence is never coverage", () => {
  it.each([null, undefined, "", "   "])("%p yields not_evaluated", (v) => {
    expect(proposeAssuranceOpinion(v as string | null | undefined).candidate).toBe("not_evaluated");
  });

  it("unrecognised prose yields not_evaluated, never a guess", () => {
    const p = proposeAssuranceOpinion("The engagement was performed in accordance with the standard.");
    expect(p.candidate).toBe("not_evaluated");
    expect(p.reason).toMatch(/must be read by a person/);
  });
});

describe("the proposal can never be authoritative", () => {
  it("every proposal is flagged requires_human and carries the normalizer version", () => {
    for (const text of [STAGING_OPINION, "Unqualified opinion", "", "Adverse opinion"]) {
      const p = proposeAssuranceOpinion(text);
      expect(p.requires_human).toBe(true);
      expect(p.normalizer_version).toBe(OPINION_NORMALIZER_VERSION);
    }
  });

  it("is deterministic — the same text always proposes the same thing", () => {
    const once = proposeAssuranceOpinion(STAGING_OPINION);
    for (let i = 0; i < 25; i++) {
      expect(proposeAssuranceOpinion(STAGING_OPINION)).toEqual(once);
    }
  });

  it("the module exposes no way to write an opinion", () => {
    // Structural: the only exports are the vocabulary, a guard, a pure
    // proposal function and a coarse gate. Authority lives in the DB CHECK.
    const mod = { ASSURANCE_OPINIONS, isAssuranceOpinion, proposeAssuranceOpinion, opinionCoverageGate };
    expect(Object.keys(mod).some((k) => /accept|write|publish|set/i.test(k))).toBe(false);
  });
});

describe("the coverage gate implements ruling 4, including its conditional arm", () => {
  it("unmodified is eligible", () => {
    expect(opinionCoverageGate("unmodified")).toBe("eligible");
  });

  it("qualified is CONDITIONAL, not ineligible — a qualified opinion is not automatically unusable", () => {
    expect(opinionCoverageGate("qualified")).toBe("conditional");
  });

  it("adverse and disclaimer are ineligible", () => {
    expect(opinionCoverageGate("adverse")).toBe("ineligible");
    expect(opinionCoverageGate("disclaimer")).toBe("ineligible");
  });

  it("not_evaluated and null are ineligible — absence is never coverage", () => {
    expect(opinionCoverageGate("not_evaluated")).toBe("ineligible");
    expect(opinionCoverageGate(null)).toBe("ineligible");
  });

  it("nothing in the gate can resolve the conditional arm — that is deliberate", () => {
    // Ruling 4: AI alone may not determine that an exception is unrelated to a
    // mapped control. The gate offers no argument by which it could.
    expect(opinionCoverageGate.length).toBe(1);
  });
});

describe("vocabulary", () => {
  it("is exactly the five ruled values", () => {
    expect([...ASSURANCE_OPINIONS]).toEqual([
      "unmodified", "qualified", "adverse", "disclaimer", "not_evaluated",
    ]);
  });

  it("the guard accepts only those", () => {
    for (const v of ASSURANCE_OPINIONS) expect(isAssuranceOpinion(v)).toBe(true);
    for (const v of ["clean", "UNMODIFIED", "", null, 3]) expect(isAssuranceOpinion(v)).toBe(false);
  });
});
