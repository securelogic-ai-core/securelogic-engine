/**
 * erasurePolicy.test.ts — the E-2 Increment 3 decisions, proven without a
 * database. These are the rules that decide whether an irreversible act
 * proceeds; they should be checkable without standing up Postgres to ask.
 */
import { describe, it, expect } from "vitest";

import {
  APPROVAL_TTL_HOURS, FINGERPRINT_EXCLUDED_TABLES,
  approvalExpiry, canApproveErasure, canRequestErasure, certificateRetainUntil,
  diffInventory, evaluateExecutionGate, organizationNameDigest, scopeFingerprint,
} from "../lib/governance/erasure/erasurePolicy.js";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("scope fingerprint", () => {
  it("is stable across key order", () => {
    expect(scopeFingerprint(ORG_A, { b: 2, a: 1 })).toBe(scopeFingerprint(ORG_A, { a: 1, b: 2 }));
  });

  it("is salted by organization — the same shape in two tenants differs", () => {
    expect(scopeFingerprint(ORG_A, { a: 1 })).not.toBe(scopeFingerprint(ORG_B, { a: 1 }));
  });

  it("changes when any counted table changes", () => {
    expect(scopeFingerprint(ORG_A, { a: 1 })).not.toBe(scopeFingerprint(ORG_A, { a: 2 }));
    expect(scopeFingerprint(ORG_A, { a: 1 })).not.toBe(scopeFingerprint(ORG_A, { a: 1, b: 1 }));
  });

  it("ignores the ledgers the governance process writes to itself", () => {
    // Otherwise every approval invalidated its own fingerprint the instant it
    // was created — found by building it.
    const base = { ask_messages: 3 };
    expect(scopeFingerprint(ORG_A, base))
      .toBe(scopeFingerprint(ORG_A, { ...base, security_audit_log: 99, erasure_certificates: 4 }));
    expect(FINGERPRINT_EXCLUDED_TABLES.has("security_audit_log")).toBe(true);
  });

  it("an organization name is retained only as a digest", () => {
    const d = organizationNameDigest("Acme Health");
    expect(d).toHaveLength(64);
    expect(d).not.toContain("Acme");
  });
});

describe("inventory diff", () => {
  it("reports additions, removals and count changes", () => {
    const d = diffInventory({ a: 1, b: 2 }, { b: 5, c: 1 });
    expect(d.changed).toBe(true);
    expect(d.removed).toEqual(["a"]);
    expect(d.added).toEqual(["c"]);
    expect(d.countChanged).toEqual([{ table: "b", from: 2, to: 5 }]);
  });

  it("is unchanged when only excluded ledgers moved", () => {
    expect(diffInventory({ a: 1, security_audit_log: 1 }, { a: 1, security_audit_log: 9 }).changed)
      .toBe(false);
  });
});

describe("authority", () => {
  const admin = { actorUserId: "u1", actorRole: "admin", reason: "offboarding" };

  it("only a named admin may request", () => {
    expect(canRequestErasure(admin).allowed).toBe(true);
    expect(canRequestErasure({ ...admin, actorUserId: null }).reason).toBe("requires_user");
    expect(canRequestErasure({ ...admin, actorRole: "analyst" }).reason).toBe("admin_role_required");
    expect(canRequestErasure({ ...admin, reason: "  " }).reason).toBe("reason_required");
  });

  it("the requester can never approve their own request", () => {
    expect(canApproveErasure({
      actorUserId: "u1", actorRole: "admin", requestedByUserId: "u1", currentStatus: "draft",
    }).reason).toBe("self_approval");
    expect(canApproveErasure({
      actorUserId: "u2", actorRole: "admin", requestedByUserId: "u1", currentStatus: "draft",
    }).allowed).toBe(true);
  });

  it("an already-approved certificate cannot be approved again", () => {
    expect(canApproveErasure({
      actorUserId: "u2", actorRole: "admin", requestedByUserId: "u1", currentStatus: "approved",
    }).reason).toBe("already_approved");
  });
});

describe("expiry and retention", () => {
  it("an approval expires after the declared TTL", () => {
    const at = new Date("2026-08-16T00:00:00Z");
    expect(approvalExpiry(at).toISOString())
      .toBe(new Date(at.getTime() + APPROVAL_TTL_HOURS * 3600_000).toISOString());
  });

  it("a certificate is retained seven years", () => {
    expect(certificateRetainUntil(new Date("2026-08-16T00:00:00Z")).getUTCFullYear()).toBe(2033);
  });
});

describe("the execution gate re-derives every condition", () => {
  const ok = {
    status: "approved", dryRun: false, requestedByUserId: "u1", approvedByUserId: "u2",
    approvalExpiresAt: new Date("2026-08-17T00:00:00Z"), scopeFingerprint: "fp",
    observedFingerprint: "fp", organizationExists: true, activeLegalHolds: 0,
    requesterStillAuthorized: true, approverStillAuthorized: true,
    now: new Date("2026-08-16T12:00:00Z"),
  };

  it("proceeds only when every condition holds", () => {
    expect(evaluateExecutionGate(ok).proceed).toBe(true);
  });

  it("a hold refuses even with a perfect approval — the TOCTOU case", () => {
    expect(evaluateExecutionGate({ ...ok, activeLegalHolds: 1 }).refusal).toBe("legal_hold_active");
  });

  it("a changed scope refuses — approval bound an inventory, not a name", () => {
    expect(evaluateExecutionGate({ ...ok, observedFingerprint: "other" }).refusal).toBe("scope_changed");
  });

  it("a retry from 'executing' is allowed to re-pass the gate", () => {
    expect(evaluateExecutionGate({ ...ok, status: "executing" }).proceed).toBe(true);
  });

  it("a deprovisioned approver voids the approval — ruling 2026-08-16", () => {
    expect(evaluateExecutionGate({ ...ok, approverStillAuthorized: false }).refusal)
      .toBe("approver_unauthorized");
    expect(evaluateExecutionGate({ ...ok, requesterStillAuthorized: false }).refusal)
      .toBe("requester_unauthorized");
  });

  it("terminal states are never re-executed", () => {
    for (const status of ["completed", "failed", "abandoned"]) {
      expect(evaluateExecutionGate({ ...ok, status }).refusal).toBe("terminal_state");
    }
  });
});
