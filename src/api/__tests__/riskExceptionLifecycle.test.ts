/**
 * riskExceptionLifecycle.test.ts — SL-EXC-1.
 *
 * THE FALSE STATE THIS FILE EXISTS TO PREVENT EVER RETURNING.
 *
 * findingLifecycleMachine closes a finding when a binding acceptance exists,
 * and its own comment says why: "Accepting a risk is a decision that no
 * remediation work remains." That is right for an ACCEPTANCE and wrong for an
 * EXCEPTION, which is the opposite statement — the work is still required,
 * still outstanding, and merely authorised to run late.
 *
 * Before this package the platform could only express "overdue" or "closed".
 * Recording an exception therefore made it assert that remediation was DONE the
 * moment someone said they could not finish in time: a finding that closes
 * because it could not be fixed. An auditor reading that record would be told
 * the opposite of the truth, and the customer's overdue population would
 * quietly shrink every time they granted an extension.
 *
 * These tests are written against the two shared SQL predicates rather than
 * through the route, because the predicates are where the correction lives —
 * `SQL_ACCEPTANCE_BINDING` is imported by the closure policy, the closure
 * service, the derivation and the reopen path, so proving the discriminator
 * there proves it for all four.
 */
import { describe, it, expect } from "vitest";

import {
  SQL_ACCEPTANCE_BINDING,
  SQL_EXCEPTION_IN_FORCE,
  DECISION_KINDS,
  ACCEPTANCE_LIVE_STATES,
} from "../lib/riskAcceptanceContract.js";
import { deriveOperationalStatus } from "../lib/findingLifecycleMachine.js";
import { evaluateFindingClosure } from "../lib/findingClosurePolicy.js";

describe("the two decisions are distinguishable at all", () => {
  it("both kinds exist and are named for what they mean", () => {
    expect([...DECISION_KINDS]).toEqual(["acceptance", "exception"]);
  });

  it("the binding predicate is scoped to acceptances only", () => {
    // The one line that corrects the lifecycle. Every consumer of "binding"
    // imports this string, so the discriminator cannot be forgotten at a call
    // site — there is only one site.
    expect(SQL_ACCEPTANCE_BINDING).toMatch(/a\.kind = 'acceptance'/);
  });

  it("an exception has its own predicate, and it is NOT a closure input", () => {
    expect(SQL_EXCEPTION_IN_FORCE).toMatch(/a\.kind = 'exception'/);
    // Structurally the mirror — approved and unexpired — so "in force" means
    // the same thing for both, while only one of them closes anything.
    expect(SQL_EXCEPTION_IN_FORCE).toMatch(/a\.state = 'approved'/);
    expect(SQL_EXCEPTION_IN_FORCE).toMatch(/expires_at >= CURRENT_DATE/);
  });

  it("both predicates still expire on the DATE, not on a sweep having run", () => {
    // A lapsed authorisation stops applying on the next derivation whether or
    // not the worker fired this morning.
    for (const sql of [SQL_ACCEPTANCE_BINDING, SQL_EXCEPTION_IN_FORCE]) {
      expect(sql).toMatch(/expires_at IS NULL OR .*expires_at >= CURRENT_DATE/s);
    }
  });

  it("a live decision occupies the slot in the same states for both kinds", () => {
    expect([...ACCEPTANCE_LIVE_STATES]).toEqual(["proposed", "approved", "legacy_unverified"]);
  });
});

/* ── 1. Approving an exception does not close the finding ────────────────── */

describe("an approved exception leaves the finding OPEN", () => {
  it("with remediation under way, the finding stays in_progress", () => {
    // hasBindingAcceptance is false for an exception BY CONSTRUCTION: the SQL
    // that computes it filters on kind='acceptance'. This asserts the machine's
    // behaviour given that input.
    const status = deriveOperationalStatus(
      ["in_progress"],
      undefined,
      { decisionState: "needs_review", legacyStatus: "open", hasBindingAcceptance: false }
    );

    expect(status).toBe("in_progress");
  });

  it("with remediation raised but not started, the finding stays open", () => {
    // 'open' is not an ACTIVE action status in this machine — the point is that
    // whatever it derives, it is never 'closed' while the exception stands.
    const status = deriveOperationalStatus(
      ["open"],
      undefined,
      { decisionState: "needs_review", legacyStatus: "open", hasBindingAcceptance: false }
    );

    expect(status).not.toBe("closed");
  });

  it("with no remediation work yet, the finding stays open", () => {
    const status = deriveOperationalStatus(
      [],
      undefined,
      { decisionState: "needs_review", legacyStatus: "open", hasBindingAcceptance: false }
    );

    expect(status).toBe("open");
  });

  it("an ACCEPTANCE still closes it — the correction did not break the other kind", () => {
    const status = deriveOperationalStatus(
      ["in_progress"],
      undefined,
      { decisionState: "needs_review", legacyStatus: "open", hasBindingAcceptance: true }
    );

    expect(status).toBe("closed");
  });
});

/* ── 9. Legitimate closure paths still work ─────────────────────────────── */

describe("the legitimate closure paths are untouched", () => {
  it("a governance resolution still closes", () => {
    expect(
      deriveOperationalStatus([], undefined, {
        decisionState: "resolved", legacyStatus: "open", hasBindingAcceptance: false,
      })
    ).toBe("closed");
  });

  it("all actions complete still reaches remediated", () => {
    expect(
      deriveOperationalStatus(["closed", "closed"], undefined, {
        decisionState: "needs_review", legacyStatus: "open", hasBindingAcceptance: false,
      })
    ).toBe("remediated");
  });

  it("the evidence gate still holds remediation back when enforced", () => {
    expect(
      deriveOperationalStatus(["closed"], { enforced: true, hasEvidence: false }, {
        decisionState: "needs_review", legacyStatus: "open", hasBindingAcceptance: false,
      })
    ).toBe("in_progress");
  });

  it("the legacy terminal bridge still closes", () => {
    expect(
      deriveOperationalStatus([], undefined, {
        decisionState: "needs_review", legacyStatus: "closed", hasBindingAcceptance: false,
      })
    ).toBe("closed");
  });
});

/* ── Closure policy: an exception does not unlock manual closure ─────────── */

describe("an exception does not unlock closure through the policy either", () => {
  it("open actions still block closure when no acceptance is binding", () => {
    // The other consumer of the same predicate. An exception must not become a
    // side door to the closure the derivation refuses.
    const verdict = evaluateFindingClosure(
      { openActions: 2, hasBindingAcceptance: false },
      { requireEvidence: false, hasEvidence: false }
    );

    expect(verdict.allowed).toBe(false);
  });

  it("a binding ACCEPTANCE still unlocks it", () => {
    const verdict = evaluateFindingClosure(
      { openActions: 2, hasBindingAcceptance: true },
      { requireEvidence: false, hasEvidence: false }
    );

    expect(verdict.allowed).toBe(true);
  });
});
