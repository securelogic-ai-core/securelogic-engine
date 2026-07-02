import { describe, it, expect } from "vitest";
import {
  evaluateTransition,
  legacyStatusForTransition,
  isLifecycleState,
  DEFAULT_LIFECYCLE_STATE,
  LIFECYCLE_STATES,
  type GateInputs,
} from "../lib/riskLifecycleStateMachine.js";

/** All gates satisfied for the analyst happy path; override per test. */
function gates(overrides: Partial<GateInputs> = {}): GateInputs {
  return {
    hasOwner: true,
    hasScore: true,
    hasEvidence: true,
    evidenceGateEnforced: false,
    treatmentCount: 1,
    approvalGranted: false,
    approvalRequired: true,
    actorUserId: "user-1",
    proposerUserId: "user-2",
    ...overrides,
  };
}

describe("evaluateTransition — state normalisation & fail-safe", () => {
  it("treats NULL current state as 'draft'", () => {
    const d = evaluateTransition(null, "begin_assessment", gates());
    expect(d.allowed).toBe(true);
    expect(d.fromState).toBe("draft");
    expect(d.toState).toBe("scoping");
  });

  it("treats empty string as 'draft'", () => {
    expect(evaluateTransition("", "begin_assessment", gates()).allowed).toBe(true);
  });

  it("rejects an unknown/garbage state with unknown_state (never throws)", () => {
    const d = evaluateTransition("wat", "begin_assessment", gates());
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("unknown_state");
    expect(d.fromState).toBeUndefined();
  });
});

describe("evaluateTransition — happy-path edges", () => {
  const cases: Array<[string, string, string]> = [
    ["draft", "begin_assessment", "scoping"],
    ["scoping", "advance_to_treatment", "treatment_selection"],
    ["treatment_selection", "submit_for_approval", "pending_approval"],
    ["mitigation", "complete_mitigation", "validation"],
    ["validation", "pass_validation", "residual_review"],
    ["residual_review", "close", "closed"],
    ["closed", "reopen", "residual_review"],
    ["closed", "archive", "archived"],
    ["residual_review", "archive", "archived"],
    ["archived", "unarchive", "closed"],
  ];
  it.each(cases)("%s --%s--> %s", (from, transition, to) => {
    const d = evaluateTransition(from, transition, gates());
    expect(d.allowed).toBe(true);
    expect(d.toState).toBe(to);
  });
});

describe("evaluateTransition — gate failures (409 reasons)", () => {
  it("owner_required when advancing without an owner", () => {
    const d = evaluateTransition("scoping", "advance_to_treatment", gates({ hasOwner: false }));
    expect(d).toMatchObject({ allowed: false, reason: "owner_required" });
  });

  it("score_required when advancing with an owner but no score", () => {
    const d = evaluateTransition("scoping", "advance_to_treatment", gates({ hasScore: false }));
    expect(d).toMatchObject({ allowed: false, reason: "score_required" });
  });

  it("owner is checked before score", () => {
    const d = evaluateTransition(
      "scoping",
      "advance_to_treatment",
      gates({ hasOwner: false, hasScore: false })
    );
    expect(d.reason).toBe("owner_required");
  });

  it("evidence_required ONLY when the org enforces the evidence gate", () => {
    // enforced + missing => blocked
    expect(
      evaluateTransition("scoping", "advance_to_treatment", gates({ evidenceGateEnforced: true, hasEvidence: false })).reason
    ).toBe("evidence_required");
    // enforced + present => allowed
    expect(
      evaluateTransition("scoping", "advance_to_treatment", gates({ evidenceGateEnforced: true, hasEvidence: true })).allowed
    ).toBe(true);
    // NOT enforced + missing => allowed (advisory by default)
    expect(
      evaluateTransition("scoping", "advance_to_treatment", gates({ evidenceGateEnforced: false, hasEvidence: false })).allowed
    ).toBe(true);
  });

  it("treatment_required to submit for approval", () => {
    const d = evaluateTransition("treatment_selection", "submit_for_approval", gates({ treatmentCount: 0 }));
    expect(d).toMatchObject({ allowed: false, reason: "treatment_required" });
  });

  it("score_required to close", () => {
    const d = evaluateTransition("residual_review", "close", gates({ hasScore: false }));
    expect(d).toMatchObject({ allowed: false, reason: "score_required" });
  });
});

describe("evaluateTransition — approval edges (recognised in R1, executed in R2)", () => {
  it("approve fails with actor_identity_required on the API-key path (no actor)", () => {
    const d = evaluateTransition("pending_approval", "approve", gates({ actorUserId: null }));
    expect(d).toMatchObject({ allowed: false, reason: "actor_identity_required" });
  });

  it("approve fails separation_of_duties when approver == proposer", () => {
    const d = evaluateTransition(
      "pending_approval",
      "approve",
      gates({ actorUserId: "same", proposerUserId: "same", approvalGranted: true })
    );
    expect(d).toMatchObject({ allowed: false, reason: "separation_of_duties" });
  });

  it("approve fails approval_required when no approval has been granted (R1 default)", () => {
    const d = evaluateTransition(
      "pending_approval",
      "approve",
      gates({ actorUserId: "a", proposerUserId: "b", approvalGranted: false })
    );
    expect(d).toMatchObject({ allowed: false, reason: "approval_required" });
  });

  it("approve is ALLOWED once gates are met (machine recognises the edge)", () => {
    const d = evaluateTransition(
      "pending_approval",
      "approve",
      gates({ actorUserId: "a", proposerUserId: "b", approvalGranted: true })
    );
    expect(d).toMatchObject({ allowed: true, toState: "mitigation" });
  });

  it("reject loops back to treatment_selection when actor differs from proposer", () => {
    const d = evaluateTransition(
      "pending_approval",
      "reject",
      gates({ actorUserId: "a", proposerUserId: "b" })
    );
    expect(d).toMatchObject({ allowed: true, toState: "treatment_selection" });
  });

  it("start_mitigation_direct requires approval NOT be required (unsatisfiable in R1)", () => {
    expect(
      evaluateTransition("treatment_selection", "start_mitigation_direct", gates({ approvalRequired: true })).reason
    ).toBe("approval_required");
    expect(
      evaluateTransition("treatment_selection", "start_mitigation_direct", gates({ approvalRequired: false })).allowed
    ).toBe(true);
  });
});

describe("evaluateTransition — loop-backs", () => {
  it("validation-fail → mitigation", () => {
    expect(evaluateTransition("validation", "fail_validation", gates()).toState).toBe("mitigation");
  });
  it("rescore → scoping from every active post-scoping state", () => {
    for (const from of ["treatment_selection", "pending_approval", "mitigation", "validation", "residual_review"]) {
      expect(evaluateTransition(from, "rescore", gates()).toState).toBe("scoping");
    }
  });
});

describe("evaluateTransition — terminal & invalid transitions", () => {
  it("terminal_state for a known transition that a terminal state does not permit", () => {
    expect(evaluateTransition("closed", "begin_assessment", gates()).reason).toBe("terminal_state");
    expect(evaluateTransition("closed", "complete_mitigation", gates()).reason).toBe("terminal_state");
    expect(evaluateTransition("archived", "reopen", gates()).reason).toBe("terminal_state");
  });

  it("closed still permits reopen/archive; archived permits unarchive", () => {
    expect(evaluateTransition("closed", "reopen", gates()).allowed).toBe(true);
    expect(evaluateTransition("closed", "archive", gates()).allowed).toBe(true);
    expect(evaluateTransition("archived", "unarchive", gates()).allowed).toBe(true);
  });

  it("invalid_transition for a valid transition from the wrong state", () => {
    expect(evaluateTransition("draft", "close", gates()).reason).toBe("invalid_transition");
    expect(evaluateTransition("scoping", "approve", gates()).reason).toBe("invalid_transition");
  });

  it("invalid_transition for an unknown transition name from an active state", () => {
    expect(evaluateTransition("scoping", "teleport", gates()).reason).toBe("invalid_transition");
  });
});

describe("legacyStatusForTransition — R1 only touches status on terminal-ish moves", () => {
  it("close/archive/unarchive → 'closed', reopen → 'open'", () => {
    expect(legacyStatusForTransition("close")).toBe("closed");
    expect(legacyStatusForTransition("archive")).toBe("closed");
    expect(legacyStatusForTransition("unarchive")).toBe("closed");
    expect(legacyStatusForTransition("reopen")).toBe("open");
  });
  it("all other transitions leave legacy status untouched (null)", () => {
    for (const t of [
      "begin_assessment",
      "advance_to_treatment",
      "submit_for_approval",
      "start_mitigation_direct",
      "approve",
      "reject",
      "complete_mitigation",
      "pass_validation",
      "fail_validation",
      "rescore",
    ] as const) {
      expect(legacyStatusForTransition(t)).toBeNull();
    }
  });
});

describe("helpers", () => {
  it("isLifecycleState recognises the 9 states and rejects others", () => {
    for (const s of LIFECYCLE_STATES) expect(isLifecycleState(s)).toBe(true);
    expect(isLifecycleState("open")).toBe(false);
    expect(isLifecycleState(null)).toBe(false);
    expect(isLifecycleState(42)).toBe(false);
  });
  it("DEFAULT_LIFECYCLE_STATE is draft", () => {
    expect(DEFAULT_LIFECYCLE_STATE).toBe("draft");
  });
});
