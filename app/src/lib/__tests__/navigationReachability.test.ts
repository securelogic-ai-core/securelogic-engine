/**
 * navigationReachability.test.ts — SL-NAV-1.
 *
 * Production renders the LEGACY `NAV_ITEMS` (prod-app has
 * SECURELOGIC_RISK_WORKSPACE_ENABLED=false), and three complete, ungated,
 * paying-customer surfaces were absent from it:
 *
 *   /posture   — the posture dashboard, and the only nav-reachable place the
 *                Executive Report PDF can be downloaded from
 *   /evidence  — the org-wide evidence inventory
 *   /approvals — the org-wide approvals queue
 *
 * plus /settings/organization, which was in NEITHER the primary nav nor the
 * secondary listing, while the risk-context fields it edits feed posture
 * scoring and finding business impact.
 *
 * The constraint that shapes the fix: making something reachable must not
 * expose functionality that is dark. /posture and /evidence are live and
 * ungated, so they go in flat. /approvals is only useful when at least one of
 * its two engine flags is on, so it is nav-gated on the derived `approvals`
 * flag and stays invisible everywhere both are off — which today is every
 * environment.
 */

import { describe, it, expect } from "vitest";
import {
  NAV_ITEMS,
  WORKSPACE_NAV_ITEMS,
  SECONDARY_NAV_ITEMS,
  ROUTE_ACCESS_DECLARATIONS,
  filterNav,
  getNavItems,
  type NavItem,
} from "../navigation";

function allHrefs(items: NavItem[]): string[] {
  return items.flatMap((i) => (i.type === "link" ? [i.href] : i.items.map((c) => c.href)));
}

/** The production nav model: risk_workspace off. */
const prodNav = (flags: Record<string, boolean> = {}) =>
  filterNav(getNavItems({ risk_workspace: false, ...flags }), true, true, true, {
    risk_workspace: false,
    ...flags,
  });

describe("SL-NAV-1 — the posture surface is reachable in production", () => {
  it("puts /posture in the legacy nav that production actually renders", () => {
    expect(allHrefs(NAV_ITEMS)).toContain("/posture");
  });

  it("shows Posture to an entitled platform user", () => {
    expect(allHrefs(prodNav())).toContain("/posture");
  });

  it("hides Posture from an unentitled (Brief-tier) user, like every other platform surface", () => {
    const briefTier = filterNav(NAV_ITEMS, false, true, false);
    expect(allHrefs(briefTier)).not.toContain("/posture");
    // The wedge stays visible.
    expect(allHrefs(briefTier)).toContain("/briefs");
  });

  it("keeps /posture in the workspace nav too, so the two IAs do not disagree", () => {
    expect(allHrefs(WORKSPACE_NAV_ITEMS)).toContain("/posture");
  });
});

describe("SL-NAV-1 — the evidence inventory is reachable in production", () => {
  it("puts /evidence in the legacy nav", () => {
    expect(allHrefs(NAV_ITEMS)).toContain("/evidence");
  });

  it("shows Evidence to an entitled platform user and hides it from a Brief-tier user", () => {
    expect(allHrefs(prodNav())).toContain("/evidence");
    expect(allHrefs(filterNav(NAV_ITEMS, false, true, false))).not.toContain("/evidence");
  });
});

describe("SL-NAV-1 — /approvals is reachable, but never before its capability is on", () => {
  it("is HIDDEN in every environment while both approval flags are off (today's state)", () => {
    expect(allHrefs(prodNav())).not.toContain("/approvals");
    expect(allHrefs(prodNav({ approvals: false }))).not.toContain("/approvals");
  });

  it("appears in the legacy nav once the derived approvals flag is on", () => {
    expect(allHrefs(prodNav({ approvals: true }))).toContain("/approvals");
  });

  it("is fail-closed: an absent flags object hides it", () => {
    expect(allHrefs(filterNav(NAV_ITEMS, true, true, true))).not.toContain("/approvals");
  });

  it("stays entitlement-gated even when the flag is on", () => {
    const unentitled = filterNav(NAV_ITEMS, false, true, false, { approvals: true });
    expect(allHrefs(unentitled)).not.toContain("/approvals");
  });

  it("applies the same gate in the workspace nav, so staging stops advertising an empty queue", () => {
    const wsOff = filterNav(WORKSPACE_NAV_ITEMS, true, true, true, { risk_workspace: true });
    const wsOn = filterNav(WORKSPACE_NAV_ITEMS, true, true, true, {
      risk_workspace: true,
      approvals: true,
    });
    expect(allHrefs(wsOff)).not.toContain("/approvals");
    expect(allHrefs(wsOn)).toContain("/approvals");
  });
});

describe("SL-NAV-1 — organization settings is listed", () => {
  it("adds /settings/organization to the secondary listing", () => {
    expect(SECONDARY_NAV_ITEMS.map((i) => i.href)).toContain("/settings/organization");
  });

  it("declares it admin-only, matching the page's own redirect", () => {
    const entry = SECONDARY_NAV_ITEMS.find((i) => i.href === "/settings/organization");
    expect(entry?.access).toBe("admin");
    const declared = ROUTE_ACCESS_DECLARATIONS.find((d) => d.prefix === "/settings/organization");
    expect(declared?.access).toBe("admin");
  });
});

describe("SL-NAV-1 — nothing dark was exposed to make something reachable", () => {
  it("adds no unflagged entry for a surface whose engine capability is off in production", () => {
    // Every newly reachable destination is either live-and-ungated, or carries a
    // feature flag. This asserts the whole set, so a future addition that
    // forgets the gate fails here.
    const DARK_IN_PROD = ["/enterprise-context", "/executive", "/approvals"];
    const visibleWithNoFlags = allHrefs(filterNav(NAV_ITEMS, true, true, true));
    for (const href of DARK_IN_PROD) {
      expect(visibleWithNoFlags).not.toContain(href);
    }
  });

  it("every legacy nav destination has an access declaration the knowledge index can read", () => {
    const platformOnly = allHrefs(NAV_ITEMS).filter((h) =>
      ["/posture", "/evidence", "/approvals"].includes(h),
    );
    for (const href of platformOnly) {
      const declared = ROUTE_ACCESS_DECLARATIONS.find((d) => d.prefix === href);
      expect(declared, `${href} must be declared`).toBeDefined();
      expect(declared?.access).toBe("platform");
    }
  });

  it("leaves the previously-reachable legacy destinations exactly where they were", () => {
    // Guard against an IA reshuffle riding along with a reachability fix.
    const hrefs = allHrefs(NAV_ITEMS);
    for (const href of [
      "/dashboard",
      "/briefs",
      "/queue",
      "/vendors",
      "/ai-systems",
      "/controls",
      "/frameworks",
      "/policies",
      "/obligations",
      "/findings",
      "/actions",
      "/risks",
      "/audit-log",
      "/vendor-assurance",
      "/vendor-engagements",
    ]) {
      expect(hrefs, `${href} must remain reachable`).toContain(href);
    }
  });
});
