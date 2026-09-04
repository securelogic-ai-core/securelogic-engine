/**
 * responseCompleteness.test.ts — the WA-1 submit gate (owner ruling 3).
 *
 * The module is pure, so this suite is exhaustive over the rule surface rather
 * than illustrative: 4 answers x 4 evidence policies is 16 cells, and every one
 * is asserted. A rule that decides whether an assessment may be submitted
 * should not have untested corners.
 */

import { describe, it, expect } from "vitest";

import {
  EVIDENCE_POLICIES,
  RESPONSE_ANSWERS,
  asEvidencePolicy,
  evidenceRequired,
  explanationRequired,
  hasExplanation,
  incompleteItems,
  isResponseAnswer,
  summarizeIncomplete,
  type CompletenessItem,
  type EvidencePolicy,
  type ResponseAnswer,
} from "../lib/vendorPortal/responseCompleteness.js";

function item(over: Partial<CompletenessItem> = {}): CompletenessItem {
  return {
    requirement_id: "11111111-1111-1111-1111-111111111111",
    reference: "CAS-01",
    mandatory: true,
    answer: "pass",
    notes: null,
    evidence_policy: "optional",
    evidence_count: 0,
    ...over,
  };
}

describe("vocabulary", () => {
  it("accepts exactly the four portal answers", () => {
    for (const a of RESPONSE_ANSWERS) expect(isResponseAnswer(a)).toBe(true);
    for (const bad of ["not_assessed", "PASS", "", null, undefined, 1]) {
      expect(isResponseAnswer(bad)).toBe(false);
    }
  });

  it("reads an absent or unknown evidence policy as `optional`", () => {
    // Pre-VA-Q1-P2 scope items have no question version, so the join yields
    // NULL. Failing closed here (treating NULL as `required_always`) would
    // block every historical engagement from ever submitting.
    expect(asEvidencePolicy(null)).toBe("optional");
    expect(asEvidencePolicy(undefined)).toBe("optional");
    expect(asEvidencePolicy("nonsense")).toBe("optional");
    for (const p of EVIDENCE_POLICIES) expect(asEvidencePolicy(p)).toBe(p);
  });

  it("treats whitespace-only notes as no explanation", () => {
    expect(hasExplanation(null)).toBe(false);
    expect(hasExplanation("")).toBe(false);
    expect(hasExplanation("   \n\t ")).toBe(false);
    expect(hasExplanation("x")).toBe(true);
  });
});

describe("explanationRequired — the full 4x4 grid", () => {
  // Owner ruling 3: partial / fail / not_applicable ALWAYS require words.
  // `pass` requires them only where the question's evidence policy asks for
  // more ("unless methodology/evidence policy requires more").
  const EXPECTED: Record<ResponseAnswer, Record<EvidencePolicy, boolean>> = {
    partial: { none: true, optional: true, required_on_pass: true, required_always: true },
    fail: { none: true, optional: true, required_on_pass: true, required_always: true },
    not_applicable: { none: true, optional: true, required_on_pass: true, required_always: true },
    pass: { none: false, optional: false, required_on_pass: true, required_always: true },
  };

  for (const answer of RESPONSE_ANSWERS) {
    for (const policy of EVIDENCE_POLICIES) {
      it(`${answer} + ${policy} -> ${EXPECTED[answer][policy]}`, () => {
        expect(explanationRequired(answer, policy)).toBe(EXPECTED[answer][policy]);
      });
    }
  }
});

describe("evidenceRequired — the full 4x4 grid", () => {
  // Only the QUESTION can demand an artifact; the answer alone never does.
  // `not_applicable` is exempt even from `required_always`: demanding proof of
  // a control the vendor has justified as inapplicable asks for a document that
  // cannot exist, and would push an honest vendor toward answering `fail`.
  const EXPECTED: Record<ResponseAnswer, Record<EvidencePolicy, boolean>> = {
    pass: { none: false, optional: false, required_on_pass: true, required_always: true },
    partial: { none: false, optional: false, required_on_pass: false, required_always: true },
    fail: { none: false, optional: false, required_on_pass: false, required_always: true },
    not_applicable: { none: false, optional: false, required_on_pass: false, required_always: false },
  };

  for (const answer of RESPONSE_ANSWERS) {
    for (const policy of EVIDENCE_POLICIES) {
      it(`${answer} + ${policy} -> ${EXPECTED[answer][policy]}`, () => {
        expect(evidenceRequired(answer, policy)).toBe(EXPECTED[answer][policy]);
      });
    }
  }

  it("is a no-op across the library as it exists today", () => {
    // Every bridged question carries the bridge default `optional`
    // (questionContent.ts). Wiring the contract must change NOTHING until a
    // curated question sets a stricter policy — this is the assertion that the
    // WA-1 rollout is behaviourally inert on the current corpus.
    for (const answer of RESPONSE_ANSWERS) {
      expect(evidenceRequired(answer, "optional")).toBe(false);
    }
  });
});

describe("incompleteItems", () => {
  it("passes a complete questionnaire", () => {
    expect(
      incompleteItems([
        item({ answer: "pass" }),
        item({ reference: "CAS-02", answer: "partial", notes: "MFA on admin only." }),
        item({ reference: "CAS-03", answer: "fail", notes: "No process yet; Q3 plan." }),
        item({ reference: "CAS-04", answer: "not_applicable", notes: "We hold no personal data." }),
      ])
    ).toEqual([]);
  });

  it("reproduces the owner walkthrough: negatives with no explanation are refused", () => {
    // The exact shape measured on engagement f27c87ae before this shipped —
    // partial and fail answered, notes empty on every one.
    const out = incompleteItems([
      item({ reference: "CAS-05", answer: "partial", notes: null }),
      item({ reference: "CAS-06", answer: "fail", notes: "" }),
      item({ reference: "CAS-07", answer: "not_applicable", notes: "   " }),
      item({ reference: "CAS-08", answer: "pass", notes: null }),
    ]);
    expect(out).toEqual([
      { requirement_id: item().requirement_id, reference: "CAS-05", reason: "explanation_missing" },
      { requirement_id: item().requirement_id, reference: "CAS-06", reason: "explanation_missing" },
      { requirement_id: item().requirement_id, reference: "CAS-07", reason: "explanation_missing" },
    ]);
  });

  it("blocks an unanswered MANDATORY item and allows an unanswered optional one", () => {
    // The shipped `all_mandatory_answered` guard, unchanged. An optional
    // question a vendor chose to skip is a choice, not an omission.
    const out = incompleteItems([
      item({ reference: "M1", mandatory: true, answer: null }),
      item({ reference: "O1", mandatory: false, answer: null }),
    ]);
    expect(out).toEqual([
      { requirement_id: item().requirement_id, reference: "M1", reason: "unanswered" },
    ]);
  });

  it("requires an explanation on an OPTIONAL item that was answered negatively", () => {
    // Deliberately wider than the unanswered rule: an optional control answered
    // `fail` promotes to a Finding with the same severity machinery, so tying
    // the explanation requirement to `mandatory` would leave the
    // least-supervised answers the least explained.
    const out = incompleteItems([item({ reference: "O2", mandatory: false, answer: "fail", notes: null })]);
    expect(out).toEqual([
      { requirement_id: item().requirement_id, reference: "O2", reason: "explanation_missing" },
    ]);
  });

  it("reports the explanation before the evidence when both are missing", () => {
    // One reason per item: a vendor fixing the words will usually attach the
    // file in the same pass, and two entries for one question reads as two
    // problems.
    const out = incompleteItems([
      item({ reference: "E1", answer: "pass", notes: null, evidence_policy: "required_always", evidence_count: 0 }),
    ]);
    expect(out).toEqual([
      { requirement_id: item().requirement_id, reference: "E1", reason: "explanation_missing" },
    ]);
  });

  it("reports missing evidence once the explanation is there", () => {
    const out = incompleteItems([
      item({
        reference: "E2",
        answer: "pass",
        notes: "Encrypted with AES-256 at rest.",
        evidence_policy: "required_always",
        evidence_count: 0,
      }),
    ]);
    expect(out).toEqual([
      { requirement_id: item().requirement_id, reference: "E2", reason: "evidence_missing" },
    ]);
  });

  it("accepts an item whose required evidence is attached", () => {
    expect(
      incompleteItems([
        item({
          answer: "pass",
          notes: "See the attached policy.",
          evidence_policy: "required_always",
          evidence_count: 1,
        }),
      ])
    ).toEqual([]);
  });

  it("never demands evidence for not_applicable, even under required_always", () => {
    expect(
      incompleteItems([
        item({
          answer: "not_applicable",
          notes: "The service processes no cardholder data.",
          evidence_policy: "required_always",
          evidence_count: 0,
        }),
      ])
    ).toEqual([]);
  });

  it("treats an unrecognised stored status as unanswered", () => {
    // `requirement_responses.status` also admits `not_assessed` (20260924),
    // which the portal never writes. It must read as "no answer", not crash and
    // not silently pass the gate.
    const out = incompleteItems([item({ reference: "X1", answer: "not_assessed" })]);
    expect(out).toEqual([
      { requirement_id: item().requirement_id, reference: "X1", reason: "unanswered" },
    ]);
  });

  it("preserves input order so the refusal matches the vendor's screen", () => {
    const out = incompleteItems([
      item({ reference: "Z9", answer: "fail", notes: null }),
      item({ reference: "A1", answer: "partial", notes: null }),
    ]);
    expect(out.map((i) => i.reference)).toEqual(["Z9", "A1"]);
  });

  it("is empty for an empty scope", () => {
    expect(incompleteItems([])).toEqual([]);
  });
});

describe("summarizeIncomplete", () => {
  it("counts each reason independently", () => {
    const counts = summarizeIncomplete([
      { requirement_id: "a", reference: "A", reason: "unanswered" },
      { requirement_id: "b", reference: "B", reason: "explanation_missing" },
      { requirement_id: "c", reference: "C", reason: "explanation_missing" },
      { requirement_id: "d", reference: "D", reason: "evidence_missing" },
    ]);
    expect(counts).toEqual({
      unanswered_required: 1,
      explanations_missing: 2,
      evidence_missing: 1,
    });
  });

  it("is all zeros for a complete questionnaire", () => {
    expect(summarizeIncomplete([])).toEqual({
      unanswered_required: 0,
      explanations_missing: 0,
      evidence_missing: 0,
    });
  });
});
