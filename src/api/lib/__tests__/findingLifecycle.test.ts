/**
 * findingLifecycle.test.ts — pure-function coverage for the Finding two-axis
 * lifecycle engine (docs/specs/finding-lifecycle-spec.md, RATIFIED 2026-07-10).
 *
 * Covers §1.1 (operational derivation), §4 (decision transition table incl.
 * the close guard and the accepted-risk override), and the audit-event naming.
 * The in-transaction appliers are covered by test/isolation/findingLifecycle.test.ts.
 */

import { describe, expect, it } from "vitest";

import {
  deriveOperationalStatus,
  evaluateFindingDecisionTransition,
  operationalAuditEvent,
} from "../findingLifecycleMachine.js";

describe("deriveOperationalStatus (spec §1.1)", () => {
  it("is open with no linked actions", () => {
    expect(deriveOperationalStatus([])).toBe("open");
  });

  it("is open when actions exist but none has started", () => {
    expect(deriveOperationalStatus(["open", "open"])).toBe("open");
  });

  it("is in_progress when any action is in_progress", () => {
    expect(deriveOperationalStatus(["open", "in_progress"])).toBe("in_progress");
  });

  it("treats blocked as active work (in_progress)", () => {
    expect(deriveOperationalStatus(["blocked", "closed"])).toBe("in_progress");
  });

  it("is remediated only when every action is terminal and ≥1 existed", () => {
    expect(deriveOperationalStatus(["closed"])).toBe("remediated");
    expect(deriveOperationalStatus(["closed", "accepted"])).toBe("remediated");
  });

  it("is NOT remediated while any action is still open", () => {
    expect(deriveOperationalStatus(["closed", "open"])).toBe("open");
  });

  it("regresses from remediated when new work is added (pure recompute)", () => {
    // remediated set + a new open action → no longer all-terminal
    expect(deriveOperationalStatus(["closed", "accepted", "open"])).toBe("open");
  });

  it("fails safe on unknown statuses (never remediated)", () => {
    expect(deriveOperationalStatus(["garbage"])).toBe("open");
    expect(deriveOperationalStatus(["closed", "garbage"])).toBe("open");
  });
});

describe("operationalAuditEvent (spec §4 audit column)", () => {
  it("names the first advance", () => {
    expect(operationalAuditEvent("open", "in_progress")).toEqual({
      eventType: "finding.operational.advanced",
      transition: "operational_advanced",
    });
  });

  it("names remediation completion", () => {
    expect(operationalAuditEvent("in_progress", "remediated")).toEqual({
      eventType: "finding.remediated",
      transition: "operational_remediated",
    });
    // open → remediated (single action closed immediately) is still remediation
    expect(operationalAuditEvent("open", "remediated").eventType).toBe("finding.remediated");
  });

  it("names every other recompute (incl. regressions)", () => {
    expect(operationalAuditEvent("remediated", "open").eventType).toBe(
      "finding.operational.recomputed"
    );
    expect(operationalAuditEvent("remediated", "in_progress").eventType).toBe(
      "finding.operational.recomputed"
    );
  });
});

describe("evaluateFindingDecisionTransition (spec §4)", () => {
  const opOpen = { operationalStatus: "open" };
  const opRemediated = { operationalStatus: "remediated" };

  it("allows needs_review → mitigating (accept plan)", () => {
    const d = evaluateFindingDecisionTransition("needs_review", "mitigating", opOpen);
    expect(d).toMatchObject({
      allowed: true,
      transition: "accept_plan",
      auditEvent: "finding.decision.mitigating",
    });
  });

  it("rejects resolved → mitigating (must reopen first)", () => {
    const d = evaluateFindingDecisionTransition("resolved", "mitigating", opRemediated);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("invalid_decision_transition");
  });

  it("allows accept-risk from any state (audited governance override)", () => {
    for (const from of ["needs_review", "mitigating", "resolved"]) {
      const d = evaluateFindingDecisionTransition(from, "accepted_risk", opOpen);
      expect(d.allowed).toBe(true);
      expect(d.transition).toBe("accept_risk");
      expect(d.auditEvent).toBe("finding.decision.accepted_risk");
    }
  });

  it("BLOCKS close while work is open and no override exists (the close guard)", () => {
    const d = evaluateFindingDecisionTransition("needs_review", "resolved", opOpen);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("close_requires_remediated_or_accepted_risk");

    const d2 = evaluateFindingDecisionTransition("mitigating", "resolved", {
      operationalStatus: "in_progress",
    });
    expect(d2.allowed).toBe(false);
  });

  it("allows close when operational_status is remediated", () => {
    const d = evaluateFindingDecisionTransition("mitigating", "resolved", opRemediated);
    expect(d).toMatchObject({
      allowed: true,
      transition: "close",
      auditEvent: "finding.decision.resolved",
    });
  });

  it("allows close from accepted_risk regardless of operational state (override)", () => {
    const d = evaluateFindingDecisionTransition("accepted_risk", "resolved", opOpen);
    expect(d.allowed).toBe(true);
    expect(d.transition).toBe("close");
  });

  it("allows resolved → needs_review (reopen)", () => {
    const d = evaluateFindingDecisionTransition("resolved", "needs_review", opRemediated);
    expect(d).toMatchObject({
      allowed: true,
      transition: "reopen",
      auditEvent: "finding.reopened",
    });
  });

  it("rejects mitigating → needs_review (no backward drift without reopen semantics)", () => {
    const d = evaluateFindingDecisionTransition("mitigating", "needs_review", opOpen);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("invalid_decision_transition");
  });

  it("treats same-state writes as idempotent no-ops (nothing to record)", () => {
    const d = evaluateFindingDecisionTransition("mitigating", "mitigating", opOpen);
    expect(d.allowed).toBe(true);
    expect(d.noop).toBe(true);
    expect(d.transition).toBeUndefined();
  });

  it("fails safe on unknown current state (incl. legacy 'in_progress')", () => {
    expect(evaluateFindingDecisionTransition("in_progress", "mitigating", opOpen).allowed).toBe(false);
    expect(evaluateFindingDecisionTransition(null, "mitigating", opOpen).reason).toBe("unknown_state");
    expect(evaluateFindingDecisionTransition("garbage", "resolved", opOpen).reason).toBe("unknown_state");
  });

  it("rejects invalid target values (incl. the removed 'in_progress')", () => {
    const d = evaluateFindingDecisionTransition("needs_review", "in_progress", opOpen);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("invalid_decision_state");
  });
});

describe("evidence gate (spec §1.1 — org-enforced remediation evidence)", () => {
  const allTerminal = ["closed", "accepted"];

  it("gate off: terminal actions remediate regardless of evidence", () => {
    expect(deriveOperationalStatus(allTerminal, { enforced: false, hasEvidence: false })).toBe("remediated");
    expect(deriveOperationalStatus(allTerminal)).toBe("remediated"); // omitted = legacy
  });

  it("gate on without evidence: completed work stays in_progress (never remediated)", () => {
    expect(deriveOperationalStatus(allTerminal, { enforced: true, hasEvidence: false })).toBe("in_progress");
  });

  it("gate on with evidence: remediates", () => {
    expect(deriveOperationalStatus(allTerminal, { enforced: true, hasEvidence: true })).toBe("remediated");
  });

  it("gate never manufactures progress: open/in-progress work is unaffected", () => {
    expect(deriveOperationalStatus([], { enforced: true, hasEvidence: true })).toBe("open");
    expect(deriveOperationalStatus(["open"], { enforced: true, hasEvidence: true })).toBe("open");
    expect(deriveOperationalStatus(["in_progress"], { enforced: true, hasEvidence: true })).toBe("in_progress");
  });
});

describe("closure separation of duties (spec §7 — org-enforced)", () => {
  const remediated = { operationalStatus: "remediated" };
  const sod = (enforced: boolean, actor: string | null, remediator: string | null) => ({
    ...remediated,
    sod: { enforced, actorUserId: actor, remediatorUserId: remediator },
  });

  it("not enforced: the remediator may close (default behaviour unchanged)", () => {
    const d = evaluateFindingDecisionTransition("mitigating", "resolved", sod(false, "u1", "u1"));
    expect(d.allowed).toBe(true);
  });

  it("enforced: an unidentified actor (API-key-only) cannot close", () => {
    const d = evaluateFindingDecisionTransition("mitigating", "resolved", sod(true, null, "u1"));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("actor_identity_required");
  });

  it("enforced: the remediator cannot close their own work", () => {
    const d = evaluateFindingDecisionTransition("mitigating", "resolved", sod(true, "u1", "u1"));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("separation_of_duties");
  });

  it("enforced: a different identified user may close", () => {
    const d = evaluateFindingDecisionTransition("mitigating", "resolved", sod(true, "u2", "u1"));
    expect(d.allowed).toBe(true);
    expect(d.transition).toBe("close");
  });

  it("enforced with unknown remediator: an identified user may close (null-counterparty, mirrors risk gate)", () => {
    const d = evaluateFindingDecisionTransition("mitigating", "resolved", sod(true, "u1", null));
    expect(d.allowed).toBe(true);
  });

  it("SoD applies to the accepted_risk override close path too", () => {
    const d = evaluateFindingDecisionTransition("accepted_risk", "resolved", {
      operationalStatus: "open",
      sod: { enforced: true, actorUserId: "u1", remediatorUserId: "u1" },
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("separation_of_duties");
  });

  it("SoD never affects non-close transitions", () => {
    const d = evaluateFindingDecisionTransition("needs_review", "mitigating", {
      operationalStatus: "open",
      sod: { enforced: true, actorUserId: null, remediatorUserId: null },
    });
    expect(d.allowed).toBe(true);
  });
});
