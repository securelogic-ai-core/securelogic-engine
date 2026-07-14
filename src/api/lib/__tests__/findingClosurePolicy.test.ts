/**
 * findingClosurePolicy.test.ts — the rule itself, with no database and no HTTP.
 *
 * The route tests (test/isolation/findingLegacyClosureGate.test.ts) prove the rule is WIRED
 * IN. These prove the rule is RIGHT — and, being pure, they pin the exact truth table a
 * second copy of the logic would have to drift from.
 *
 * The flag deliberately lives OUTSIDE evaluateFindingClosure(): the flag decides whether a
 * caller consults the policy, not what the policy says. That keeps the rule testable as a
 * rule, and is why there is no flag argument anywhere below.
 */

import { describe, expect, it } from "vitest";

import {
  CLOSE_REQUIRES_REMEDIATION_COMPLETE,
  evaluateFindingClosure,
  findingClosureGateEnabled,
} from "../findingClosurePolicy.js";

describe("evaluateFindingClosure", () => {
  it("permits closure when no remediation exists at all", () => {
    // A false positive, or a finding that needed no remediation. A rule about FINISHING
    // remediation must not block a finding that never had any.
    expect(evaluateFindingClosure({ openActions: 0, hasBindingAcceptance: false })).toEqual({
      allowed: true,
    });
  });

  it("permits closure when all remediation is complete", () => {
    // Terminal actions are not counted as open by loadClosureBlockers, so "all complete"
    // reaches the policy as zero.
    expect(evaluateFindingClosure({ openActions: 0, hasBindingAcceptance: false }).allowed).toBe(
      true
    );
  });

  it("REFUSES closure while remediation is incomplete", () => {
    const decision = evaluateFindingClosure({ openActions: 3, hasBindingAcceptance: false });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("unreachable");

    expect(decision.httpStatus).toBe(409);
    expect(decision.body.error).toBe(CLOSE_REQUIRES_REMEDIATION_COMPLETE);
    expect(decision.body.open_actions).toBe(3);
    expect(decision.body.message).toContain("3 open remediation actions");
  });

  it("permits closure with incomplete remediation when the risk is formally accepted", () => {
    // The second limb. An approved, unexpired acceptance IS the decision that no remediation
    // remains — it is the rule, not an exception carved around it.
    expect(evaluateFindingClosure({ openActions: 3, hasBindingAcceptance: true })).toEqual({
      allowed: true,
    });
  });

  it("says 'action' not 'actions' for exactly one blocker", () => {
    // The message reaches customers. "1 open remediation actions" is the kind of thing that
    // makes a product feel unfinished.
    const decision = evaluateFindingClosure({ openActions: 1, hasBindingAcceptance: false });
    if (decision.allowed) throw new Error("expected a refusal");

    expect(decision.body.message).toContain("1 open remediation action.");
    expect(decision.body.message).toContain("Close or cancel it");
  });

  it("treats a negative count as no blockers rather than refusing", () => {
    // Defensive: a COUNT can never be negative, but the rule must fail OPEN toward the
    // legacy behaviour if it ever sees nonsense, not invent a refusal a customer cannot clear.
    expect(evaluateFindingClosure({ openActions: -1, hasBindingAcceptance: false }).allowed).toBe(
      true
    );
  });
});

describe("findingClosureGateEnabled", () => {
  const FLAG = "SECURELOGIC_FINDING_CLOSURE_GATE_ENABLED";

  it("is OFF when absent — the position production ships in", () => {
    expect(findingClosureGateEnabled({})).toBe(false);
  });

  it("is ON only for the exact string 'true'", () => {
    expect(findingClosureGateEnabled({ [FLAG]: "true" })).toBe(true);

    // Anything else is off. A typo, a "1", a "TRUE" from a dashboard field, or an empty
    // string must never silently enforce a contract change on a customer.
    for (const v of ["false", "1", "TRUE", "True", "yes", "", " true"]) {
      expect(findingClosureGateEnabled({ [FLAG]: v })).toBe(false);
    }
  });
});
