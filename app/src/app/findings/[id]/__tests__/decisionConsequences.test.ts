/**
 * decisionConsequences.test.ts — the Governance Decision panel's option model.
 *
 * Pins what the panel OFFERS (only legal transitions), what each option SAYS
 * (resulting governance state, operational effect, closure eligibility), when a
 * rationale is REQUIRED, and when closure is disabled by open remediation.
 */
import { describe, it, expect } from "vitest";
import { decisionOptions } from "../decisionConsequences";

const base = { openActionCount: 0, riskAcceptanceActive: false };

describe("decisionOptions — only legal, non-noop transitions are offered", () => {
  it("needs_review + remediated offers mitigating, accepted_risk, resolved — not itself", () => {
    const opts = decisionOptions({ ...base, decisionState: "needs_review", operationalStatus: "remediated" });
    expect(opts.map((o) => o.value)).toEqual(["mitigating", "accepted_risk", "resolved"]);
  });

  it("needs_review + in_progress does NOT offer resolved (closure ineligible)", () => {
    const opts = decisionOptions({ ...base, decisionState: "needs_review", operationalStatus: "in_progress" });
    expect(opts.map((o) => o.value)).toEqual(["mitigating", "accepted_risk"]);
  });

  it("resolved offers the reopen (needs_review)", () => {
    const opts = decisionOptions({ ...base, decisionState: "resolved", operationalStatus: "closed" });
    expect(opts.map((o) => o.value)).toContain("needs_review");
    expect(opts.map((o) => o.value)).not.toContain("resolved");
  });

  it("an unknown/legacy current state offers nothing (fail-safe)", () => {
    expect(decisionOptions({ ...base, decisionState: "weird", operationalStatus: "open" })).toEqual([]);
  });
});

describe("decisionOptions — the signed risk-acceptance workflow owns accepted_risk", () => {
  it("excludes accepted_risk when the workflow is active", () => {
    const opts = decisionOptions({
      ...base,
      riskAcceptanceActive: true,
      decisionState: "needs_review",
      operationalStatus: "remediated",
    });
    expect(opts.map((o) => o.value)).not.toContain("accepted_risk");
    expect(opts.map((o) => o.value)).toContain("resolved");
  });
});

describe("decisionOptions — consequences and rationale requirements", () => {
  const opts = decisionOptions({ ...base, decisionState: "needs_review", operationalStatus: "remediated" });
  const by = (v: string) => opts.find((o) => o.value === v)!;

  it("every option states its resulting governance state and closure eligibility", () => {
    expect(by("resolved").consequence).toMatch(/Closes the finding/);
    expect(by("resolved").consequence).toMatch(/Resolved/);
    expect(by("mitigating").consequence).toMatch(/stays active/);
    expect(by("accepted_risk").consequence).toMatch(/eligible for closure without full remediation/);
  });

  it("closing decisions require a rationale; plan acceptance does not", () => {
    expect(by("resolved").requiresNote).toBe(true);
    expect(by("accepted_risk").requiresNote).toBe(true);
    expect(by("mitigating").requiresNote).toBe(false);
  });

  it("open remediation disables resolved with a stated reason (server still enforces)", () => {
    const blocked = decisionOptions({
      ...base,
      openActionCount: 2,
      decisionState: "needs_review",
      operationalStatus: "remediated",
    });
    const resolved = blocked.find((o) => o.value === "resolved")!;
    expect(resolved.disabled).toBe(true);
    expect(resolved.disabledReason).toMatch(/2 remediation actions still open/);
    // The others stay recordable.
    expect(blocked.find((o) => o.value === "mitigating")!.disabled).toBe(false);
  });
});
