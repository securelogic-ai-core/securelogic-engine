import { describe, it, expect } from "vitest";
import {
  canApprove,
  isApproverRole,
  APPROVER_ROLES,
} from "../lib/riskApprovalAuthority.js";

describe("isApproverRole", () => {
  it("recognises admin as the designated approver role", () => {
    expect(isApproverRole("admin")).toBe(true);
  });
  it("rejects every non-approver role and non-strings", () => {
    for (const r of ["analyst", "member", "viewer", "owner", "", null, undefined]) {
      expect(isApproverRole(r as never)).toBe(false);
    }
  });
  it("the approver set is exactly {admin} for R2", () => {
    expect([...APPROVER_ROLES]).toEqual(["admin"]);
  });
});

describe("canApprove", () => {
  it("refuses API-key-only callers (no user identity) — Q2", () => {
    expect(canApprove({ actorUserId: null, actorRole: "admin" })).toEqual({
      allowed: false,
      reason: "approval_requires_user",
    });
  });

  it("refuses a JWT user who is not an approver", () => {
    for (const role of ["analyst", "member", "viewer", null]) {
      expect(canApprove({ actorUserId: "u1", actorRole: role })).toEqual({
        allowed: false,
        reason: "approver_role_required",
      });
    }
  });

  it("allows an admin JWT user", () => {
    expect(canApprove({ actorUserId: "u1", actorRole: "admin" })).toEqual({ allowed: true });
  });

  it("threshold/severity inputs are inert today (admin allowed regardless)", () => {
    expect(
      canApprove({
        actorUserId: "u1",
        actorRole: "admin",
        residualScore: 5,
        approvalThresholdScore: 90,
      }).allowed
    ).toBe(true);
    // A non-admin stays refused even with a low/high score — authority is role-based.
    expect(
      canApprove({
        actorUserId: "u1",
        actorRole: "member",
        residualScore: 99,
        approvalThresholdScore: 10,
      }).reason
    ).toBe("approver_role_required");
  });
});
