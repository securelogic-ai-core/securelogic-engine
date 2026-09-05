import { describe, it, expect } from "vitest";
import {
  ATTENTION_REASONS,
  ATTENTION_REASON_LABELS,
  ATTENTION_REASON_DETAIL,
  ATTENTION_WINDOW_STATES,
  DISPOSITIONS,
  DISPOSITION_LABELS,
  RATIONALE_MIN,
  deriveAttention,
  digestOf,
  dispositionStale,
  emptyCounts,
  inAttentionWindow,
  isAttentionReason,
  isDisposition,
  rationaleRequired,
  type AttentionItem,
} from "../lib/vendorRisk/attentionSignals.js";
import { ENGAGEMENT_STATES } from "../lib/vendorRisk/engagementStateMachine.js";

const ctx = (status: string, over: Partial<{ unreviewed_evidence_count: number; active_finding_count: number }> = {}) => ({
  status,
  unreviewed_evidence_count: 0,
  active_finding_count: 0,
  ...over,
});

const item = (over: Partial<AttentionItem> = {}): AttentionItem => ({
  requirement_id: "r1",
  mandatory: true,
  answer: "pass",
  notes: "we do this",
  evidence_policy: "optional",
  ...over,
});

describe("the attention window", () => {
  it("is a subset of the real engagement states", () => {
    for (const s of ATTENTION_WINDOW_STATES) {
      expect(ENGAGEMENT_STATES).toContain(s);
    }
  });

  it("excludes every state where the vendor is still answering", () => {
    for (const s of ["draft", "scoping", "scoped", "issued", "in_progress"]) {
      expect(inAttentionWindow(s)).toBe(false);
    }
  });

  it("excludes the post-decision states, which carry their own signals", () => {
    for (const s of ["decided", "monitoring", "closed", "cancelled", "expired"]) {
      expect(inAttentionWindow(s)).toBe(false);
    }
  });

  it("suppresses every reason outside the window, however bad the answers are", () => {
    const items = [item({ answer: "fail", notes: null }), item({ requirement_id: "r2", answer: "partial", notes: null })];
    const out = deriveAttention(items, ctx("in_progress", { unreviewed_evidence_count: 9, active_finding_count: 4 }));
    expect(out.needs_attention).toBe(false);
    expect(out.reasons).toEqual([]);
    expect(out.digest).toBe("none");
  });
});

describe("derivation", () => {
  it("a fully passed, explained assessment needs nothing", () => {
    const out = deriveAttention([item(), item({ requirement_id: "r2" })], ctx("in_review"));
    expect(out.needs_attention).toBe(false);
    expect(out.digest).toBe("none");
  });

  it("counts fail as control_not_in_place", () => {
    const out = deriveAttention([item({ answer: "fail", notes: "no budget yet" })], ctx("in_review"));
    expect(out.counts.control_not_in_place).toBe(1);
    expect(out.counts.explanation_missing).toBe(0);
    expect(out.reasons).toEqual(["control_not_in_place"]);
  });

  it("counts partial separately from fail", () => {
    const out = deriveAttention(
      [item({ answer: "partial", notes: "half of the estate" }), item({ requirement_id: "r2", answer: "fail", notes: "none" })],
      ctx("in_review")
    );
    expect(out.counts.partial_response).toBe(1);
    expect(out.counts.control_not_in_place).toBe(1);
  });

  it("defers the explanation rule to responseCompleteness — unexplained partial/fail/NA all count", () => {
    const items = [
      item({ requirement_id: "a", answer: "partial", notes: null }),
      item({ requirement_id: "b", answer: "fail", notes: "   " }),
      item({ requirement_id: "c", answer: "not_applicable", notes: "" }),
    ];
    const out = deriveAttention(items, ctx("submitted"));
    expect(out.counts.explanation_missing).toBe(3);
  });

  it("does NOT flag an explained not_applicable — the highest-integrity answer is not a defect", () => {
    const out = deriveAttention(
      [item({ answer: "not_applicable", notes: "we never process cardholder data" })],
      ctx("in_review")
    );
    expect(out.needs_attention).toBe(false);
  });

  it("an affirmative answer is explanation-free unless the question's policy asks for more", () => {
    expect(deriveAttention([item({ answer: "pass", notes: null })], ctx("in_review")).counts.explanation_missing).toBe(0);
    expect(
      deriveAttention([item({ answer: "pass", notes: null, evidence_policy: "required_on_pass" })], ctx("in_review"))
        .counts.explanation_missing
    ).toBe(1);
  });

  it("only MANDATORY unanswered items count — an optional skip is a choice", () => {
    const out = deriveAttention(
      [item({ answer: null, mandatory: true }), item({ requirement_id: "r2", answer: null, mandatory: false })],
      ctx("submitted")
    );
    expect(out.counts.unanswered_mandatory).toBe(1);
  });

  it("treats the legacy not_assessed status as unanswered, exactly as isResponseAnswer does", () => {
    const out = deriveAttention([item({ answer: "not_assessed", mandatory: true })], ctx("submitted"));
    expect(out.counts.unanswered_mandatory).toBe(1);
    expect(out.counts.explanation_missing).toBe(0);
  });

  it("carries the engagement-level counts through", () => {
    const out = deriveAttention([item()], ctx("analysis_complete", { unreviewed_evidence_count: 3, active_finding_count: 2 }));
    expect(out.counts.evidence_unreviewed).toBe(3);
    expect(out.counts.active_finding).toBe(2);
    expect(out.reasons).toEqual(["evidence_unreviewed", "active_finding"]);
  });

  it("returns reasons in vocabulary order, not in the order they were found", () => {
    const out = deriveAttention(
      [item({ answer: "partial", notes: null }), item({ requirement_id: "r2", answer: "fail", notes: "why" })],
      ctx("in_review", { active_finding_count: 1 })
    );
    expect(out.reasons).toEqual(["control_not_in_place", "partial_response", "explanation_missing", "active_finding"]);
  });
});

describe("the digest", () => {
  it("is 'none' for a clean assessment, never an empty string", () => {
    expect(digestOf(emptyCounts())).toBe("none");
  });

  it("is stable and readable", () => {
    const counts = emptyCounts();
    counts.control_not_in_place = 2;
    counts.active_finding = 1;
    expect(digestOf(counts)).toBe("control_not_in_place:2|active_finding:1");
  });

  it("moves when the assessment moves, which is what makes a disposition stale", () => {
    const before = emptyCounts();
    before.control_not_in_place = 3;
    const after = emptyCounts();
    after.control_not_in_place = 5;
    expect(dispositionStale(digestOf(before), digestOf(after))).toBe(true);
    expect(dispositionStale(digestOf(before), digestOf(before))).toBe(false);
  });

  it("an engagement with no disposition is not stale", () => {
    expect(dispositionStale(null, "control_not_in_place:1")).toBe(false);
  });
});

describe("dispositions", () => {
  it("only the five ratified values are accepted", () => {
    expect(DISPOSITIONS).toEqual(["reviewed", "accepted", "escalated", "finding_proposed", "finding_confirmed"]);
    expect(isDisposition("closed")).toBe(false);
    expect(isDisposition("reviewed")).toBe(true);
  });

  it("every judgement carries a reason; the one acknowledgement need not", () => {
    expect(rationaleRequired("reviewed")).toBe(false);
    for (const d of ["accepted", "escalated", "finding_proposed", "finding_confirmed"] as const) {
      expect(rationaleRequired(d)).toBe(true);
    }
    expect(RATIONALE_MIN).toBeGreaterThanOrEqual(10);
  });
});

describe("explainability", () => {
  it("every reason has a label and a detail — no reason can reach a screen unnamed", () => {
    for (const r of ATTENTION_REASONS) {
      expect(ATTENTION_REASON_LABELS[r]).toBeTruthy();
      expect(ATTENTION_REASON_DETAIL[r].length).toBeGreaterThan(40);
    }
    for (const d of DISPOSITIONS) expect(DISPOSITION_LABELS[d]).toBeTruthy();
  });

  it("no label leaks an internal rule identifier to a customer surface", () => {
    for (const r of ATTENTION_REASONS) {
      const label = ATTENTION_REASON_LABELS[r];
      expect(label).not.toMatch(/\b(S[0-9]|rule|policy_|_id|[a-z]+_[a-z]+:)\b/i);
      // The label must be prose, not the reason key spelled with spaces.
      expect(label.toLowerCase()).not.toBe(r.replace(/_/g, " "));
    }
  });

  it("isAttentionReason gates the vocabulary", () => {
    expect(isAttentionReason("control_not_in_place")).toBe(true);
    expect(isAttentionReason("needs_attention")).toBe(false);
  });
});
