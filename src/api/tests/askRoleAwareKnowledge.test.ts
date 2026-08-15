/**
 * askRoleAwareKnowledge.test.ts — the prompt must not offer a non-admin a menu
 * entry their own role hides.
 *
 * WHY THIS EXISTS (W-1)
 * ---------------------
 * Walkthrough §2.5 asked a non-admin analyst about the audit log. Ask answered
 * that it is admin-only — and then told them to "navigate to Audit Log in the
 * top navigation". That user's rendered nav is
 * `Briefing · Posture · Intelligence · Risk Operations · Assets ·
 * Vendor Assurance · Compliance · Context`. No Audit Log. `/audit-log` 307s for
 * them.
 *
 * The corpus filter already omitted destinations an org's ENTITLEMENT could not
 * reach, but returned true for `admin` items on the grounds that the requester's
 * role was "a signal we don't have". It is available: requireApiKey assigns
 * req.userRole and req.userSeatType, and seatScope.scopeFromRequest() collapses
 * them to the canonical isAdmin — the same rule /api/me reports.
 *
 * The annotation was never the fix. Telling the model an item is "[admin only]"
 * does not stop it describing a path the user does not have; only removing the
 * item from the corpus does.
 */
import { describe, it, expect } from "vitest";
import { renderProductKnowledge, accessibleTo } from "../lib/productKnowledge.js";

describe("accessibleTo — role gate", () => {
  it("filters admin destinations for a requester known NOT to be an admin", () => {
    expect(accessibleTo("admin", "premium", false)).toBe(false);
  });

  it("admits them for an admin", () => {
    expect(accessibleTo("admin", "premium", true)).toBe(true);
  });

  it("leaves them visible when the role is unknown, as before", () => {
    // The knowledge-index generator and corpus-wide tests pass no role and must
    // keep rendering the complete annotated set.
    expect(accessibleTo("admin", "premium")).toBe(true);
    expect(accessibleTo("admin", "premium", undefined)).toBe(true);
  });

  it("does not disturb the entitlement dimension", () => {
    expect(accessibleTo("platform", "premium", false)).toBe(true);
    expect(accessibleTo("platform", "professional", true)).toBe(false);
    expect(accessibleTo("premium", "starter", true)).toBe(false);
    expect(accessibleTo("all", "starter", false)).toBe(true);
  });
});

describe("renderProductKnowledge — what a non-admin is told about", () => {
  const asAdmin = renderProductKnowledge("premium", true);
  const asNonAdmin = renderProductKnowledge("premium", false);
  const roleUnknown = renderProductKnowledge("premium");

  it("omits the Audit Log from a non-admin's corpus", () => {
    // The exact destination from the W-1 report.
    expect(asAdmin).toContain("/audit-log");
    expect(asNonAdmin).not.toContain("/audit-log");
  });

  it("still gives the non-admin a usable product corpus", () => {
    // Over-filtering would be its own defect: a prompt stripped to nothing
    // would "pass" this file's headline assertion while breaking the product.
    expect(asNonAdmin.length).toBeGreaterThan(500);
    expect(asNonAdmin).toContain("/dashboard");
    expect(asNonAdmin.split("\n").length).toBeGreaterThan(20);
  });

  it("removes strictly less for an admin than for a non-admin", () => {
    expect(asAdmin.length).toBeGreaterThan(asNonAdmin.length);
  });

  it("keeps the unknown-role rendering identical to the admin view", () => {
    // Callers that cannot resolve a role are unchanged by this work.
    expect(roleUnknown).toBe(asAdmin);
  });

  it("does not leak an admin-only destination through any section", () => {
    // Navigation, secondary navigation, global utilities and workflows all
    // filter on the same predicate; a leak in any one of them re-opens W-1.
    for (const marker of ["[admin only]"]) {
      expect(asNonAdmin).not.toContain(marker);
    }
  });
});
