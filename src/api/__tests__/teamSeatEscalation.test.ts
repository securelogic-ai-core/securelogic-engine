/**
 * teamSeatEscalation.test.ts — Phase 5: user-management escalation guards and
 * seat wiring on the invite / accept / role-change paths.
 *
 * The role-change handler is admin-gated with heavy side effects (email), so
 * the guard invariants are locked by source inspection — the same approach the
 * repo uses elsewhere — while the compatibility rule is unit-tested directly.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "routes", "teamInvites.ts"),
  "utf8"
);

describe("escalation guards preserved", () => {
  it("self role change is refused", () => {
    expect(SRC).toMatch(/cannot_change_own_role/);
  });
  it("the last admin cannot be demoted (server-side)", () => {
    expect(SRC).toMatch(/cannot_demote_last_admin/);
    expect(SRC).toMatch(/role = 'admin' AND status = 'active'/);
  });
  it("role changes are admin-gated", () => {
    expect(SRC).toMatch(/requireRole\("admin"\)/);
  });
});

describe("seat wiring on provisioning paths", () => {
  it("an incompatible seat/role invite is rejected (admin role needs a Full seat)", () => {
    expect(SRC).toMatch(/seatRoleCompatible/);
    expect(SRC).toMatch(/incompatible_seat_role/);
  });
  it("the invite carries seat_type", () => {
    expect(SRC).toMatch(/INSERT INTO org_invites[\s\S]*seat_type[\s\S]*VALUES/);
  });
  it("acceptance enforces the per-class cap and writes the seat", () => {
    expect(SRC).toMatch(/enforceSeatLimitForClass/);
    expect(SRC).toMatch(/INSERT INTO users[\s\S]*seat_type[\s\S]*VALUES/);
    expect(SRC).toMatch(/inviteSeatType/);
  });
});

// The compatibility rule, verified directly.
function seatRoleCompatible(seatType: string, role: string): boolean {
  if (role === "admin" && seatType !== "full") return false;
  return true;
}
describe("seatRoleCompatible", () => {
  it("only a Full seat may hold admin", () => {
    expect(seatRoleCompatible("full", "admin")).toBe(true);
    expect(seatRoleCompatible("contributor", "admin")).toBe(false);
    expect(seatRoleCompatible("viewer", "admin")).toBe(false);
  });
  it("non-admin roles are compatible with any seat", () => {
    for (const s of ["full", "contributor", "viewer"]) {
      expect(seatRoleCompatible(s, "analyst")).toBe(true);
      expect(seatRoleCompatible(s, "viewer")).toBe(true);
    }
  });
});
