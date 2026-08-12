/**
 * seatScope.test.ts (client) — Phase 7: the UI consumes the resolved seat scope
 * from /api/me. These predicates drive affordance gating (defense in depth).
 */

import { describe, it, expect } from "vitest";
import {
  hasCapability,
  canMutate,
  isContributor,
  isOrgAdmin,
  canSeeArea,
  type MeSeat,
} from "../seatScope";

const full = (over: Partial<MeSeat> = {}): MeSeat => ({
  seatType: "full", role: "admin", isAdmin: true, readScope: "tenant", writeScope: "tenant",
  capabilities: ["org:configure", "users:manage", "billing:manage", "security:configure", "audit:read", "risk:accept", "export:data"],
  enforced: true, ...over,
});
const contributor: MeSeat = { seatType: "contributor", role: "analyst", isAdmin: false, readScope: "assigned", writeScope: "assigned", capabilities: [], enforced: true };
const viewer: MeSeat = { seatType: "viewer", role: "viewer", isAdmin: false, readScope: "tenant", writeScope: "none", capabilities: [], enforced: true };

describe("client seat predicates", () => {
  it("hasCapability reflects the resolved capability set", () => {
    expect(hasCapability(full(), "users:manage")).toBe(true);
    expect(hasCapability(contributor, "export:data")).toBe(false);
    expect(hasCapability(null, "export:data")).toBe(false);
  });

  it("canMutate is false only for read-only seats", () => {
    expect(canMutate(full())).toBe(true);
    expect(canMutate(contributor)).toBe(true);
    expect(canMutate(viewer)).toBe(false);
  });

  it("Full analyst is not Org Admin (Full ≠ Admin)", () => {
    const analyst = full({ role: "analyst", isAdmin: false, capabilities: ["risk:accept", "export:data"] });
    expect(isOrgAdmin(analyst)).toBe(false);
    expect(isOrgAdmin(full())).toBe(true);
  });

  it("isContributor identifies the scoped seat", () => {
    expect(isContributor(contributor)).toBe(true);
    expect(isContributor(viewer)).toBe(false);
  });

  it("navigation gating: contributors see my-work, not governance/admin/dashboards", () => {
    expect(canSeeArea(contributor, "my-work")).toBe(true);
    expect(canSeeArea(contributor, "governance")).toBe(false);
    expect(canSeeArea(contributor, "admin")).toBe(false);
    expect(canSeeArea(contributor, "dashboards")).toBe(false);
    // Viewer sees governance reads + dashboards, not admin.
    expect(canSeeArea(viewer, "dashboards")).toBe(true);
    expect(canSeeArea(viewer, "admin")).toBe(false);
    // Full admin sees everything.
    expect(canSeeArea(full(), "admin")).toBe(true);
  });

  it("with the model OFF, everything is visible (legacy behaviour)", () => {
    const off: MeSeat = { ...contributor, enforced: false };
    expect(canSeeArea(off, "governance")).toBe(true);
    expect(canSeeArea(off, "admin")).toBe(true);
  });
});
