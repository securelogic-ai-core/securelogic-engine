/**
 * vendorControlEffectiveness.test.ts — the assurance ladder.
 *
 * The property this suite exists to protect is the one a vendor has every
 * incentive to erode: an unevidenced "yes" must not score as a working control.
 */

import { describe, expect, it } from "vitest";

import {
  ASSURANCE_MULTIPLIERS,
  LOW_COVERAGE_CAP,
  MANDATORY_FAILURE_CAP,
  MANDATORY_MULTI_FAILURE_CAP,
  DEFAULT_DEPTH_WEIGHT,
  DEPTH_WEIGHTS,
  assuranceFor,
  computeControlEffectiveness,
  type ControlResponse,
} from "../lib/vendorRisk/controlEffectiveness.js";
import { SCOPE_DEPTHS } from "../lib/vendorRisk/scopeResolver.js";

function control(over: Partial<ControlResponse> = {}): ControlResponse {
  return {
    requirement_id: over.requirement_id ?? `req-${Math.abs(hash(JSON.stringify(over)))}`,
    status: "pass",
    assurance: "evidenced",
    mandatory: false,
    depth: "confirm",
    ...over,
  };
}

/** Stable id generator — Math.random would make failures unreproducible. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h;
}

function many(n: number, over: Partial<ControlResponse> = {}): ControlResponse[] {
  return Array.from({ length: n }, (_, i) => control({ ...over, requirement_id: `r${i}` }));
}

describe("the assurance ladder", () => {
  it("an unevidenced pass scores far below an evidenced one", () => {
    // THE central property. A vendor who simply says yes must not look like a
    // vendor who proved it.
    const asserted = computeControlEffectiveness(many(10, { assurance: "asserted" }));
    const evidenced = computeControlEffectiveness(many(10, { assurance: "evidenced" }));

    expect(asserted.score).toBe(50);
    expect(evidenced.score).toBe(90);
    expect(evidenced.score - asserted.score).toBeGreaterThanOrEqual(30);
  });

  it("the multipliers rise monotonically up the ladder", () => {
    const order = ["not_assessed", "asserted", "documented", "evidenced", "attested"] as const;
    for (let i = 1; i < order.length; i++) {
      expect(
        ASSURANCE_MULTIPLIERS[order[i]!],
        `${order[i]} must outrank ${order[i - 1]}`
      ).toBeGreaterThan(ASSURANCE_MULTIPLIERS[order[i - 1]!]);
    }
  });

  it("attested only slightly exceeds evidenced", () => {
    // A clean SOC 2 is periodic and scoped — not a guarantee about today, and
    // not meaningfully better than a reviewer who read the actual evidence.
    const gap = ASSURANCE_MULTIPLIERS.attested - ASSURANCE_MULTIPLIERS.evidenced;
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThanOrEqual(0.15);
  });

  it("a partial answer earns partial credit", () => {
    const full = computeControlEffectiveness(many(10, { status: "pass", assurance: "attested" }));
    const partial = computeControlEffectiveness(many(10, { status: "partial", assurance: "attested" }));
    expect(partial.score).toBe(Math.round(full.score / 2));
  });
});

describe("assuranceFor — derived from facts, never self-reported", () => {
  it("no evidence means asserted, whatever the vendor claims", () => {
    expect(
      assuranceFor({
        status: "pass",
        evidenceCount: 0,
        evidenceConfirmed: false,
        independentlyAttested: false,
      })
    ).toBe("asserted");
  });

  it("an unread attachment is documented, not evidenced", () => {
    expect(
      assuranceFor({
        status: "pass",
        evidenceCount: 2,
        evidenceConfirmed: false,
        independentlyAttested: false,
      })
    ).toBe("documented");
  });

  it("a confirmed attachment is evidenced", () => {
    expect(
      assuranceFor({
        status: "pass",
        evidenceCount: 1,
        evidenceConfirmed: true,
        independentlyAttested: false,
      })
    ).toBe("evidenced");
  });

  it("confirmation without any attachment cannot reach evidenced", () => {
    // Guards a plausible bug: a stale confirmation flag on a control whose
    // evidence was later withdrawn.
    expect(
      assuranceFor({
        status: "pass",
        evidenceCount: 0,
        evidenceConfirmed: true,
        independentlyAttested: false,
      })
    ).toBe("asserted");
  });

  it("an honest failure is never promoted up the ladder", () => {
    // A vendor who attaches a document AND answers `fail` is being candid.
    // Lifting them to `evidenced` would multiply zero credit by a bigger number
    // — harmless arithmetically, but it would display as strong assurance on a
    // control that does not work.
    expect(
      assuranceFor({
        status: "fail",
        evidenceCount: 3,
        evidenceConfirmed: true,
        independentlyAttested: true,
      })
    ).toBe("asserted");
  });

  it("an unanswered control stays not_assessed regardless of attachments", () => {
    expect(
      assuranceFor({
        status: "not_assessed",
        evidenceCount: 5,
        evidenceConfirmed: true,
        independentlyAttested: true,
      })
    ).toBe("not_assessed");
  });
});

describe("not_applicable leaves the denominator; not_assessed does not", () => {
  it("N/A does not penalise the vendor", () => {
    const clean = computeControlEffectiveness(many(5, { assurance: "attested" }));
    const withNa = computeControlEffectiveness([
      ...many(5, { assurance: "attested" }),
      control({ requirement_id: "na1", status: "not_applicable" }),
      control({ requirement_id: "na2", status: "not_applicable" }),
    ]);
    expect(withNa.score).toBe(clean.score);
    expect(withNa.not_applicable_count).toBe(2);
    expect(withNa.assessed_count).toBe(5);
  });

  it("not_assessed DOES penalise the vendor", () => {
    // The opposite treatment, and the reason the two must never be conflated.
    const clean = computeControlEffectiveness(many(5, { assurance: "attested" }));
    const withGaps = computeControlEffectiveness([
      ...many(5, { assurance: "attested" }),
      control({ requirement_id: "g1", status: "not_assessed", assurance: "not_assessed" }),
      control({ requirement_id: "g2", status: "not_assessed", assurance: "not_assessed" }),
    ]);
    expect(withGaps.score).toBeLessThan(clean.score);
    expect(withGaps.not_assessed_count).toBe(2);
    expect(withGaps.assessed_count).toBe(7);
  });

  it("a wholly inapplicable scope scores zero and says why", () => {
    // Not a neutral 50 — an empty questionnaire must not read as a middling
    // vendor.
    const result = computeControlEffectiveness(many(4, { status: "not_applicable" }));
    expect(result.score).toBe(0);
    expect(result.basis.adjustments.map((a) => a.rule_id)).toContain("EF0");
    expect(result.basis.adjustments[0]!.explanation).toMatch(/absence of evidence/i);
  });

  it("flags a scope that is mostly inapplicable WITHOUT changing the score", () => {
    const responses = [
      ...many(2, { assurance: "attested" }),
      ...Array.from({ length: 8 }, (_, i) =>
        control({ requirement_id: `na${i}`, status: "not_applicable" })
      ),
    ];
    const result = computeControlEffectiveness(responses);
    expect(result.score).toBe(100);
    expect(result.basis.adjustments.map((a) => a.rule_id)).toContain("EF4");
    // Reported, not penalised — this is a scoping defect for a human to see.
    expect(result.basis.adjustments.find((a) => a.rule_id === "EF4")!.points).toBeUndefined();
  });
});

describe("mandatory failures are not just more zeros", () => {
  it("one failed mandatory control caps the score however good the average", () => {
    // Twenty passing trivia must not bury one failed encryption control.
    const responses = [
      ...many(20, { assurance: "attested" }),
      control({ requirement_id: "crypto", status: "fail", mandatory: true, assurance: "asserted" }),
    ];
    const result = computeControlEffectiveness(responses);

    expect(result.arithmetic_score).toBeGreaterThan(MANDATORY_FAILURE_CAP);
    expect(result.score).toBe(MANDATORY_FAILURE_CAP);
    expect(result.failed_mandatory_count).toBe(1);
    expect(result.basis.adjustments.map((a) => a.rule_id)).toContain("EF1");
  });

  it("two failed mandatory controls cap harder — a systemic weakness", () => {
    const responses = [
      ...many(20, { assurance: "attested" }),
      control({ requirement_id: "m1", status: "fail", mandatory: true, assurance: "asserted" }),
      control({ requirement_id: "m2", status: "fail", mandatory: true, assurance: "asserted" }),
    ];
    const result = computeControlEffectiveness(responses);
    expect(result.score).toBe(MANDATORY_MULTI_FAILURE_CAP);
    expect(result.basis.adjustments.map((a) => a.rule_id)).toContain("EF2");
  });

  it("a cap never RAISES a score that was already lower", () => {
    const responses = [
      ...many(10, { status: "fail", assurance: "asserted" }),
      control({ requirement_id: "m1", status: "fail", mandatory: true, assurance: "asserted" }),
    ];
    const result = computeControlEffectiveness(responses);
    expect(result.score).toBe(0);
    expect(result.basis.adjustments.map((a) => a.rule_id)).not.toContain("EF1");
  });

  it("the arithmetic result is always preserved alongside the capped one", () => {
    // Ratified: expose the arithmetic result, the rule, and the final rating.
    const responses = [
      ...many(20, { assurance: "attested" }),
      control({ requirement_id: "m1", status: "fail", mandatory: true, assurance: "asserted" }),
    ];
    const result = computeControlEffectiveness(responses);
    expect(result.arithmetic_score).not.toBe(result.score);
    const adj = result.basis.adjustments.find((a) => a.rule_id === "EF1")!;
    expect(adj.points).toBe(MANDATORY_FAILURE_CAP - result.arithmetic_score);
    expect(adj.explanation.length).toBeGreaterThan(40);
  });
});

describe("thin questionnaires cannot produce confident scores", () => {
  it("caps a high score achieved over a small sample", () => {
    const responses = [
      ...many(3, { assurance: "attested" }),
      ...Array.from({ length: 17 }, (_, i) =>
        control({ requirement_id: `u${i}`, status: "not_assessed", assurance: "not_assessed" })
      ),
    ];
    const result = computeControlEffectiveness(responses);
    expect(result.response_coverage).toBeCloseTo(0.15, 2);
    expect(result.score).toBeLessThanOrEqual(LOW_COVERAGE_CAP);
  });

  it("a complete questionnaire is not capped", () => {
    const result = computeControlEffectiveness(many(20, { assurance: "attested" }));
    expect(result.response_coverage).toBe(1);
    expect(result.score).toBe(100);
    expect(result.basis.adjustments.map((a) => a.rule_id)).not.toContain("EF3");
  });
});

describe("depth weighting", () => {
  it("a control asked at attestation depth counts less than one asked in full", () => {
    const full = computeControlEffectiveness([
      control({ requirement_id: "a", depth: "full", assurance: "attested" }),
      control({ requirement_id: "b", depth: "full", status: "fail", assurance: "asserted" }),
    ]);
    const shallow = computeControlEffectiveness([
      control({ requirement_id: "a", depth: "full", assurance: "attested" }),
      control({ requirement_id: "b", depth: "attest", status: "fail", assurance: "asserted" }),
    ]);
    // The same failure hurts less when it was only asked shallowly.
    expect(shallow.score).toBeGreaterThan(full.score);
  });

  it("an unknown or absent depth falls back to `confirm` rather than dropping the control", () => {
    for (const depth of ["some_future_depth", undefined]) {
      const result = computeControlEffectiveness([
        control({ requirement_id: "a", ...(depth ? { depth } : {}), assurance: "attested" }),
      ]);
      expect(result.score, String(depth)).toBe(100);
      expect(result.basis.factors[0]!.weight, String(depth)).toBe(DEFAULT_DEPTH_WEIGHT);
    }
  });

  it("the weight keys ARE the shipped scope vocabulary", () => {
    // The drift that already happened once: weights keyed `standard`/
    // `attestation` while the resolver emits `confirm`/`attest`, so every
    // non-full control silently took one default weight and the depth
    // distinction was discarded.
    expect(Object.keys(DEPTH_WEIGHTS).sort()).toEqual([...SCOPE_DEPTHS].sort());
  });
});

describe("the basis is self-contained and customer-safe", () => {
  it("records every applicable control as a factor with its contribution", () => {
    const result = computeControlEffectiveness(many(4, { assurance: "documented" }));
    expect(result.basis.factors).toHaveLength(4);
    for (const f of result.basis.factors) {
      expect(f.contribution).toBeGreaterThan(0);
      expect(f.weight).toBeGreaterThan(0);
    }
  });

  it("stamps the methodology version so a rating can be explained years later", () => {
    const result = computeControlEffectiveness(many(2));
    expect(result.basis.methodology_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.basis.method).toBe("vendor_effectiveness_v1");
  });

  it("every adjustment explains itself in plain language", () => {
    const result = computeControlEffectiveness([
      ...many(20, { assurance: "attested" }),
      control({ requirement_id: "m1", status: "fail", mandatory: true, assurance: "asserted" }),
    ]);
    for (const adj of result.basis.adjustments) {
      expect(adj.explanation.length).toBeGreaterThan(30);
      // Customer-visible: no internal rule syntax leaking into the panel.
      expect(adj.explanation).not.toMatch(/undefined|null|\[object/);
    }
  });
});
