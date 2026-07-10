/**
 * decisionTransitions.test.ts — the dropdown must mirror the server machine
 * (finding-lifecycle-spec §4) exactly: it never offers a move the engine 409s.
 */

import { describe, expect, it } from "vitest";

import { legalDecisionTargets } from "../decisionTransitions";

describe("legalDecisionTargets (spec §4 mirror)", () => {
  it("needs_review with open work: accept plan or accept risk — NO close", () => {
    expect(legalDecisionTargets("needs_review", "open")).toEqual([
      "needs_review",
      "mitigating",
      "accepted_risk",
    ]);
  });

  it("needs_review with remediated work: close becomes available", () => {
    expect(legalDecisionTargets("needs_review", "remediated")).toEqual([
      "needs_review",
      "mitigating",
      "accepted_risk",
      "resolved",
    ]);
  });

  it("mitigating with work in progress: only accept risk (no close, no backward drift)", () => {
    expect(legalDecisionTargets("mitigating", "in_progress")).toEqual([
      "mitigating",
      "accepted_risk",
    ]);
  });

  it("mitigating with remediated work: close available", () => {
    expect(legalDecisionTargets("mitigating", "remediated")).toContain("resolved");
  });

  it("accepted_risk: close always available (governance override)", () => {
    expect(legalDecisionTargets("accepted_risk", "open")).toEqual([
      "accepted_risk",
      "resolved",
    ]);
  });

  it("resolved: reopen or accept risk — never close again", () => {
    expect(legalDecisionTargets("resolved", "remediated")).toEqual([
      "needs_review",
      "accepted_risk",
      "resolved",
    ]);
  });

  it("fails safe on legacy/unknown current states", () => {
    expect(legalDecisionTargets("in_progress", "open")).toEqual([]);
    expect(legalDecisionTargets(null, "open")).toEqual([]);
    expect(legalDecisionTargets("garbage", "remediated")).toEqual([]);
  });
});
