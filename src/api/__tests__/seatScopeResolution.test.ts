/**
 * seatScopeResolution.test.ts — Phase 2 of the enterprise seat program.
 *
 * The centralized decision path. Covers resolveScope across every (seat, role)
 * combination, the clamping of incompatible pairs to the safe floor, the
 * contributor projection mechanism, and the flag-off passthrough of the
 * enforcement seam.
 */

import { describe, it, expect, vi } from "vitest";
import {
  resolveScope,
  scopeForApiKey,
  normalizeSeatType,
  normalizeRole,
} from "../lib/seatScope.js";
import {
  projectForContributor,
  projectListForContributor,
  hasContributorProjection,
} from "../lib/contributorProjection.js";

describe("resolveScope — Full seat", () => {
  it("Full + admin is the only path to Org Admin", () => {
    const s = resolveScope("full", "admin");
    expect(s.isAdmin).toBe(true);
    expect(s.readScope).toBe("tenant");
    expect(s.writeScope).toBe("tenant");
    expect([...s.capabilities]).toEqual(
      expect.arrayContaining(["org:configure", "users:manage", "billing:manage", "security:configure", "audit:read", "risk:accept", "export:data"])
    );
  });

  it("Full + analyst is full governance but NOT admin (Full ≠ Admin)", () => {
    const s = resolveScope("full", "analyst");
    expect(s.isAdmin).toBe(false);
    expect(s.writeScope).toBe("tenant");
    expect(s.capabilities.has("org:configure")).toBe(false);
    expect(s.capabilities.has("users:manage")).toBe(false);
    expect(s.capabilities.has("risk:accept")).toBe(true); // full governance
    expect(s.capabilities.has("export:data")).toBe(true);
  });

  it("legacy 'member' role behaves as analyst", () => {
    expect(resolveScope("full", "member")).toEqual(resolveScope("full", "analyst"));
  });

  it("Full + viewer is tenant read, no writes, no risk acceptance", () => {
    const s = resolveScope("full", "viewer");
    expect(s.readScope).toBe("tenant");
    expect(s.writeScope).toBe("none");
    expect(s.isAdmin).toBe(false);
    expect(s.capabilities.has("risk:accept")).toBe(false);
    expect(s.capabilities.has("export:data")).toBe(false);
  });
});

describe("resolveScope — Contributor seat", () => {
  it("is scoped to assigned objects and can never be admin", () => {
    const s = resolveScope("contributor", "analyst");
    expect(s.readScope).toBe("assigned");
    expect(s.writeScope).toBe("assigned");
    expect(s.isAdmin).toBe(false);
    expect(s.capabilities.has("risk:accept")).toBe(false); // only tenant-write
    expect(s.capabilities.has("export:data")).toBe(false);
  });

  it("clamps an admin role DOWN to analyst (incompatible pair → safe floor)", () => {
    const s = resolveScope("contributor", "admin");
    expect(s.effectiveRole).toBe("analyst");
    expect(s.isAdmin).toBe(false);
    expect(s.writeScope).toBe("assigned");
  });

  it("a viewer role on a contributor seat is read-only assigned", () => {
    const s = resolveScope("contributor", "viewer");
    expect(s.readScope).toBe("assigned");
    expect(s.writeScope).toBe("none");
  });
});

describe("resolveScope — Viewer seat", () => {
  it("is tenant read-only regardless of role (clamps non-viewer roles down)", () => {
    for (const role of ["admin", "analyst", "viewer"] as const) {
      const s = resolveScope("viewer", role);
      expect(s.effectiveRole).toBe("viewer");
      expect(s.readScope).toBe("tenant");
      expect(s.writeScope).toBe("none");
      expect(s.isAdmin).toBe(false);
    }
  });

  it("exports only when the org grants viewer export", () => {
    expect(resolveScope("viewer", "viewer").capabilities.has("export:data")).toBe(false);
    expect(resolveScope("viewer", "viewer", { viewerExportEnabled: true }).capabilities.has("export:data")).toBe(true);
  });
});

describe("resolveScope — normalization / fail-closed", () => {
  it("absent seat resolves to full (API-key / pre-seat-model rows)", () => {
    expect(normalizeSeatType(undefined)).toBe("full");
    expect(normalizeSeatType(null)).toBe("full");
    expect(normalizeSeatType("")).toBe("full");
  });
  it("an UNRECOGNISED seat string fails closed to viewer", () => {
    expect(normalizeSeatType("superuser")).toBe("viewer");
    expect(resolveScope("superuser", "admin").writeScope).toBe("none");
  });
  it("an unknown role fails closed to viewer", () => {
    expect(normalizeRole("wizard")).toBe("viewer");
  });
  it("scopeForApiKey is admin-level full", () => {
    const s = scopeForApiKey();
    expect(s.isAdmin).toBe(true);
    expect(s.writeScope).toBe("tenant");
  });
});

describe("contributor projection — whitelist by construction", () => {
  it("drops fields not on the allowlist", () => {
    const row = { id: "f1", title: "T", secret_internal_score: 99, owner_user_id: "u1" };
    const p = projectForContributor("finding", row)!;
    expect(p).toHaveProperty("id", "f1");
    expect(p).toHaveProperty("title", "T");
    expect(p).toHaveProperty("owner_user_id", "u1");
    expect(p).not.toHaveProperty("secret_internal_score");
  });

  it("reduces a linked object to an { id, label } stub", () => {
    const row = { id: "f1", vendor: { id: "v1", name: "Acme", risk_score: 88, contract_value: 1000000 } };
    const p = projectForContributor("finding", row)!;
    expect(p.vendor).toEqual({ id: "v1", label: "Acme" });
    expect(JSON.stringify(p)).not.toContain("contract_value");
    expect(JSON.stringify(p)).not.toContain("88");
  });

  it("returns null for an unregistered object type (caller denies)", () => {
    expect(projectForContributor("organization", { id: "o1", secret: "x" })).toBeNull();
    expect(hasContributorProjection("organization")).toBe(false);
    expect(projectListForContributor("organization", [{ id: "o1" }])).toEqual([]);
  });
});
