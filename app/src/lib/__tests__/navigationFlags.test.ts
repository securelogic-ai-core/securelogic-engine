import { describe, it, expect } from "vitest";
import {
  NAV_ITEMS,
  WORKSPACE_NAV_ITEMS,
  getNavItems,
  filterNav,
  type NavItem,
} from "../navigation";

const flaggedLink: NavItem = {
  type: "link",
  label: "Context",
  href: "/enterprise-context",
  platform: true,
  featureFlag: "enterprise_context",
};
const plainLink: NavItem = { type: "link", label: "Dashboard", href: "/dashboard" };

describe("filterNav feature flags", () => {
  it("hides a flagged item when no flags are passed (fail-closed)", () => {
    const visible = filterNav([plainLink, flaggedLink], true, true, true);
    expect(visible).toEqual([plainLink]);
  });

  it("hides a flagged item when the flag is explicitly false", () => {
    const visible = filterNav([flaggedLink], true, true, true, { enterprise_context: false });
    expect(visible).toEqual([]);
  });

  it("shows a flagged item only when the flag is true AND entitlement passes", () => {
    expect(filterNav([flaggedLink], true, true, false, { enterprise_context: true })).toEqual([
      flaggedLink,
    ]);
    // flag on but not a platform user → still hidden by the entitlement gate
    expect(filterNav([flaggedLink], false, true, false, { enterprise_context: true })).toEqual([]);
  });

  it("leaves unflagged items untouched by the flags argument", () => {
    expect(filterNav([plainLink], false, false, false, { enterprise_context: false })).toEqual([
      plainLink,
    ]);
  });

  it("the real NAV_ITEMS Context entry is dark by default", () => {
    const visible = filterNav(NAV_ITEMS, true, true, true);
    expect(visible.some((i) => "href" in i && i.href === "/enterprise-context")).toBe(false);
    const withFlag = filterNav(NAV_ITEMS, true, true, true, { enterprise_context: true });
    expect(withFlag.some((i) => "href" in i && i.href === "/enterprise-context")).toBe(true);
  });

  it("the real NAV_ITEMS Executive entry is dark by default and independent of the other flags", () => {
    const dark = filterNav(NAV_ITEMS, true, true, true);
    expect(dark.some((i) => "href" in i && i.href === "/executive")).toBe(false);
    // Neither ECL nor asset-registry alone may reveal it (independent switches).
    const others = filterNav(NAV_ITEMS, true, true, true, { enterprise_context: true, asset_registry: true });
    expect(others.some((i) => "href" in i && i.href === "/executive")).toBe(false);
    const withFlag = filterNav(NAV_ITEMS, true, true, true, { risk_intelligence: true });
    expect(withFlag.some((i) => "href" in i && i.href === "/executive")).toBe(true);
    // Flag on but not a platform user → still hidden by the entitlement gate.
    const notPlatform = filterNav(NAV_ITEMS, false, true, false, { risk_intelligence: true });
    expect(notPlatform.some((i) => "href" in i && i.href === "/executive")).toBe(false);
  });

  it("Assets exposes ONE canonical entry (Asset Registry) when the flag is on; legacy menu when off (EAR P12)", () => {
    // Flag OFF — legacy behavior unchanged: the dropdown is exactly [Vendors, AI Systems].
    const dark = filterNav(NAV_ITEMS, true, true, true);
    expect(assetsGroupChildren(dark)).toEqual(["/vendors", "/ai-systems"]);

    // The ECL flag alone must NOT change it (independent switch).
    const eclOnly = filterNav(NAV_ITEMS, true, true, true, { enterprise_context: true });
    expect(assetsGroupChildren(eclOnly)).toEqual(["/vendors", "/ai-systems"]);

    // Flag ON — Assets shows ONLY Asset Registry; Vendors / AI Systems drop out
    // of the primary nav (managed inside the registry as asset types/filters).
    const withFlag = filterNav(NAV_ITEMS, true, true, true, { asset_registry: true });
    expect(assetsGroupChildren(withFlag)).toEqual(["/assets"]);
    expect(assetsGroupChildren(withFlag)).not.toContain("/vendors");
    expect(assetsGroupChildren(withFlag)).not.toContain("/ai-systems");

    // Flag on but not a platform user → the whole Assets group is gated out.
    const notPlatform = filterNav(NAV_ITEMS, false, true, false, { asset_registry: true });
    expect(notPlatform.some((i) => i.type === "group" && i.label === "Assets")).toBe(false);
  });

  it("filterNav clones the Assets group and never mutates the shared NAV_ITEMS", () => {
    filterNav(NAV_ITEMS, true, true, true, { asset_registry: true });
    filterNav(NAV_ITEMS, true, true, true); // dark
    const source = NAV_ITEMS.find((i) => i.type === "group" && i.label === "Assets");
    expect(source && source.type === "group" ? source.items.map((c) => c.href) : []).toEqual([
      "/assets",
      "/vendors",
      "/ai-systems",
    ]);
  });

  it("there is no longer a standalone top-level Asset Registry link (folded into the group)", () => {
    const withFlag = filterNav(NAV_ITEMS, true, true, true, { asset_registry: true });
    expect(withFlag.some((i) => i.type === "link" && i.href === "/assets")).toBe(false);
  });
});

/** The visible child hrefs of the "Assets" group in a filtered nav (empty if the group is hidden). */
function assetsGroupChildren(nav: NavItem[]): string[] {
  const g = nav.find((i) => i.type === "group" && i.label === "Assets");
  return g && g.type === "group" ? g.items.map((c) => c.href) : [];
}

/** Every href reachable in a filtered nav (top-level links + group children). */
function allHrefs(nav: NavItem[]): string[] {
  const out: string[] = [];
  for (const i of nav) {
    if (i.type === "link") out.push(i.href);
    else out.push(...i.items.map((c) => c.href));
  }
  return out;
}

/** Visible child hrefs of a named group in a filtered nav. */
function groupChildren(nav: NavItem[], label: string): string[] {
  const g = nav.find((i) => i.type === "group" && i.label === label);
  return g && g.type === "group" ? g.items.map((c) => c.href) : [];
}

// ─── Enterprise Risk Workspace IA/nav (ERIP Packages 1+2, risk_workspace flag) ──

describe("getNavItems — legacy vs risk-workspace model", () => {
  it("returns the legacy NAV_ITEMS reference when the flag is off/absent", () => {
    expect(getNavItems()).toBe(NAV_ITEMS);
    expect(getNavItems({})).toBe(NAV_ITEMS);
    expect(getNavItems({ risk_workspace: false })).toBe(NAV_ITEMS);
  });

  it("returns the workspace model only when risk_workspace is true", () => {
    expect(getNavItems({ risk_workspace: true })).toBe(WORKSPACE_NAV_ITEMS);
  });

  it("flag-off nav is byte-for-byte the legacy nav (no regression, GATE B)", () => {
    // Same entitlement/flag inputs, both nav models resolved through filterNav.
    const flags = { risk_workspace: false } as const;
    const legacy = filterNav(NAV_ITEMS, true, true, true);
    const viaGetter = filterNav(getNavItems(flags), true, true, true, flags);
    expect(viaGetter).toEqual(legacy);
  });
});

describe("WORKSPACE_NAV_ITEMS (risk_workspace on)", () => {
  const ws = (isPlatform: boolean, isAdmin: boolean, extra: Record<string, boolean> = {}) =>
    filterNav(WORKSPACE_NAV_ITEMS, isPlatform, true, isAdmin, { risk_workspace: true, ...extra });

  it("groups the intelligence funnel: Briefs (all tiers) + Review Links (platform)", () => {
    // Platform user sees both.
    expect(groupChildren(ws(true, false), "Intelligence")).toEqual(["/briefs", "/queue"]);
    // Non-platform (Brief-tier) still sees the Intelligence group with Briefs only —
    // the wedge must never be gated behind platform.
    expect(groupChildren(ws(false, false), "Intelligence")).toEqual(["/briefs"]);
  });

  it("demotes Ask out of the primary nav entirely", () => {
    expect(allHrefs(ws(true, true))).not.toContain("/ask");
  });

  it("makes Findings the first Risk Operations item and surfaces Approvals", () => {
    expect(groupChildren(ws(true, false), "Risk Operations")).toEqual([
      "/findings",
      "/actions",
      "/risks",
      "/approvals",
    ]);
  });

  it("surfaces Vendor Assurance under Assets and preserves EAR asset-registry behavior", () => {
    // Registry dark: legacy vendor/ai children + Vendor Assurance.
    expect(assetsGroupChildren(ws(true, false))).toEqual([
      "/vendors",
      "/ai-systems",
      "/vendor-assurance/queue",
    ]);
    // Registry on: Vendors/AI drop to the registry; Asset Registry + Vendor Assurance remain.
    expect(assetsGroupChildren(ws(true, false, { asset_registry: true }))).toEqual([
      "/assets",
      "/vendor-assurance/queue",
    ]);
  });

  it("keeps Executive and Context dark until their own flags flip", () => {
    expect(allHrefs(ws(true, true))).not.toContain("/executive");
    expect(allHrefs(ws(true, true))).not.toContain("/enterprise-context");
    expect(allHrefs(ws(true, true, { risk_intelligence: true }))).toContain("/executive");
    expect(allHrefs(ws(true, true, { enterprise_context: true }))).toContain("/enterprise-context");
  });

  it("gates Audit Log to admins only", () => {
    expect(allHrefs(ws(true, false))).not.toContain("/audit-log");
    expect(allHrefs(ws(true, true))).toContain("/audit-log");
  });

  it("never mutates the shared WORKSPACE_NAV_ITEMS array", () => {
    filterNav(WORKSPACE_NAV_ITEMS, true, true, true, { risk_workspace: true, asset_registry: true });
    filterNav(WORKSPACE_NAV_ITEMS, false, false, false, { risk_workspace: true });
    const assets = WORKSPACE_NAV_ITEMS.find((i) => i.type === "group" && i.label === "Assets");
    expect(assets && assets.type === "group" ? assets.items.map((c) => c.href) : []).toEqual([
      "/assets",
      "/vendors",
      "/ai-systems",
      "/vendor-assurance/queue",
    ]);
  });
});
