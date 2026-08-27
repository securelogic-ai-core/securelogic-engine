import { describe, it, expect } from "vitest";
import {
  NAV_ITEMS,
  WORKSPACE_NAV_ITEMS,
  GLOBAL_UTILITY_ITEMS,
  ROUTE_ACCESS_DECLARATIONS,
  getNavItems,
  filterNav,
  isNavItemActive,
  findingsHomeLabel,
  findingExplorerLabel,
  briefingHomeLabel,
  type NavItem,
  type NavFlags,
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

  // ── The Briefing home label (Briefing Initiative B1) — supported flag matrix ──
  // briefing relabels the workspace nav's home entry ONLY; the legacy NAV_ITEMS
  // (live flag-off menu + knowledge-index source) must never change under any
  // flag combination.
  it("briefing + risk_workspace relabels only the /dashboard entry to 'Briefing'", () => {
    const items = getNavItems({ risk_workspace: true, briefing: true });
    const home = items.find((i) => i.type === "link" && i.href === "/dashboard");
    expect(home).toMatchObject({ label: "Briefing", href: "/dashboard" });
    // Everything else is the workspace model untouched (same references).
    expect(items.filter((i) => !(i.type === "link" && i.href === "/dashboard")))
      .toEqual(WORKSPACE_NAV_ITEMS.filter((i) => !(i.type === "link" && i.href === "/dashboard")));
    // The shared array itself was cloned, never mutated.
    const wsHome = WORKSPACE_NAV_ITEMS.find((i) => i.type === "link" && i.href === "/dashboard");
    expect(wsHome).toMatchObject({ label: "Dashboard" });
  });

  it("briefing WITHOUT risk_workspace leaves the legacy NAV_ITEMS byte-identical", () => {
    // Legacy nav is the knowledge-index source — it must be the same reference,
    // still labeled "Dashboard", no matter what the briefing flag says.
    expect(getNavItems({ briefing: true })).toBe(NAV_ITEMS);
    expect(getNavItems({ risk_workspace: false, briefing: true })).toBe(NAV_ITEMS);
    const home = NAV_ITEMS.find((i) => i.type === "link" && i.href === "/dashboard");
    expect(home).toMatchObject({ label: "Dashboard" });
  });

  it("risk_workspace WITHOUT briefing keeps the workspace home labeled 'Dashboard'", () => {
    expect(getNavItems({ risk_workspace: true, briefing: false })).toBe(WORKSPACE_NAV_ITEMS);
  });

  it("briefingHomeLabel follows the flag (back-links must not promise an unrendered experience)", () => {
    expect(briefingHomeLabel(true)).toBe("Briefing");
    expect(briefingHomeLabel(false)).toBe("Dashboard");
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

  it("leads Risk Operations with the two findings destinations and surfaces Approvals", () => {
    // Operations Workspace (the work hub) then Finding Explorer (the searchable
    // inventory) — one route, two distinct user intents, both reachable from the nav.
    expect(groupChildren(ws(true, false), "Risk Operations")).toEqual([
      "/findings",
      "/findings?queue=all",
      "/actions",
      "/risks",
      "/approvals",
      "/pen-tests",
    ]);
  });

  it("names the Risk Operations destinations by task, not by feature", () => {
    const group = ws(true, false).find(
      (i): i is Extract<typeof i, { type: "group" }> =>
        i.type === "group" && i.label === "Risk Operations",
    );
    expect(group?.items.map((c) => c.label)).toEqual([
      "Operations Workspace",
      "Finding Explorer",
      "Actions",
      "Risk Register",
      "Approvals",
      "Pen Tests",
    ]);
  });

  it("keeps Pen Tests reachable in BOTH nav models (PEN-1 — production renders the legacy menu)", () => {
    // Workspace IA (flag on).
    expect(allHrefs(ws(true, false))).toContain("/pen-tests");
    // Legacy IA — the LIVE flag-off menu. A workspace-only entry would ship the
    // /pen-tests pages nav-orphaned in production.
    expect(allHrefs(filterNav(NAV_ITEMS, true, true, false))).toContain("/pen-tests");
    expect(groupChildren(filterNav(NAV_ITEMS, true, true, false), "Risk")).toContain("/pen-tests");
    // Platform-gated like the rest of the Risk group.
    expect(allHrefs(filterNav(NAV_ITEMS, false, true, false))).not.toContain("/pen-tests");
    expect(allHrefs(ws(false, false))).not.toContain("/pen-tests");
  });

  it("preserves EAR asset-registry behavior under Assets", () => {
    // Registry dark: legacy vendor/ai children.
    expect(assetsGroupChildren(ws(true, false))).toEqual([
      "/vendors",
      "/ai-systems",
    ]);
    // Registry on: Vendors/AI drop to the registry.
    expect(assetsGroupChildren(ws(true, false, { asset_registry: true }))).toEqual([
      "/assets",
    ]);
  });

  it("gives Vendor Assurance its own group covering the whole engagement lifecycle", () => {
    // Regression guard for the P0: Vendor Assurance used to be ONE child under
    // Assets pointing at the document review queue, while the engagement spine
    // (/vendor-engagements) was nav-orphaned in every IA — so the workflow was
    // reachable only by typing the URL.
    const group = ws(true, false).find(
      (i): i is Extract<typeof i, { type: "group" }> =>
        i.type === "group" && i.label === "Vendor Assurance",
    );
    expect(group?.items.map((c) => c.href)).toEqual([
      "/vendor-assurance",
      "/vendor-engagements",
      "/vendor-assurance/queue",
      "/vendors",
    ]);
  });

  it("keeps the vendor list reachable when asset_registry hides it under Assets", () => {
    // asset_registry on removes /vendors from Assets. The vendor detail page is
    // where an engagement is opened from, so losing it would break the journey.
    expect(assetsGroupChildren(ws(true, false, { asset_registry: true }))).not.toContain("/vendors");
    expect(allHrefs(ws(true, false, { asset_registry: true }))).toContain("/vendors");
  });

  it("surfaces the Posture dashboard for platform users (D1 — no longer nav-orphaned)", () => {
    // The canonical org-performance destination must be reachable from the nav
    // once the workspace IA is on — otherwise relabeling /dashboard to
    // "Briefing" leaves no Dashboards destination in the header at all.
    expect(allHrefs(ws(true, false))).toContain("/posture");
    // Platform-gated like the other org-analytics surfaces.
    expect(allHrefs(ws(false, false))).not.toContain("/posture");
    // The legacy menu (the live flag-off nav and the knowledge-index source)
    // deliberately does NOT carry it.
    expect(allHrefs(filterNav(NAV_ITEMS, true, true, true))).not.toContain("/posture");
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
    ]);
  });
});

// ─── Risk Operations destination naming + active-state matching ───────────────
//
// Operations Workspace (/findings) and Finding Explorer (/findings?queue=all)
// share a PATH and differ only by query, so path-only matching would highlight the
// Workspace while the user is in the Explorer and never highlight the Explorer.

describe("isNavItemActive — two destinations on one path", () => {
  const RISK_OPS = ["/findings", "/findings?queue=all", "/actions", "/risks", "/approvals"];

  it("highlights the Workspace on bare /findings, not the Explorer", () => {
    expect(isNavItemActive("/findings", "/findings", "", RISK_OPS)).toBe(true);
    expect(isNavItemActive("/findings?queue=all", "/findings", "", RISK_OPS)).toBe(false);
  });

  it("highlights the Explorer on /findings?queue=all — and yields the Workspace", () => {
    expect(isNavItemActive("/findings?queue=all", "/findings", "?queue=all", RISK_OPS)).toBe(true);
    expect(isNavItemActive("/findings", "/findings", "?queue=all", RISK_OPS)).toBe(false);
  });

  it("keeps the Explorer active as the user searches and sorts inside it", () => {
    // Extra params the toolbar adds must not drop the highlight.
    const search = "?queue=all&severity=High&sort=due";
    expect(isNavItemActive("/findings?queue=all", "/findings", search, RISK_OPS)).toBe(true);
  });

  it("leaves the Workspace active in its own subordinate views (buckets, entity search)", () => {
    // A bucket/entity URL is the Workspace, not the Explorer: no queue=all present.
    expect(isNavItemActive("/findings", "/findings", "?bucket=sla_breached", RISK_OPS)).toBe(true);
    expect(isNavItemActive("/findings?queue=all", "/findings", "?bucket=sla_breached", RISK_OPS))
      .toBe(false);
  });

  it("preserves the caller's existing path semantics (group vs dropdown child)", () => {
    // Group button matched descendants before this helper existed; children did not.
    // Keeping that split is what makes the flag-off menu behave identically.
    expect(isNavItemActive("/risks", "/risks/abc-123", "", RISK_OPS, true)).toBe(true);
    expect(isNavItemActive("/risks", "/risks/abc-123", "", RISK_OPS, false)).toBe(false);
    // Never a prefix-of-a-different-route false positive.
    expect(isNavItemActive("/risks", "/risk-register", "", RISK_OPS, true)).toBe(false);
  });
});

// ─── Global utilities (header upper-right cluster) ────────────────────────────
//
// Search and Ask SecureLogic are no longer menu entries. The regression this
// guards is not hypothetical: production runs `risk_workspace=false` and so
// renders the LEGACY NAV_ITEMS, which means a destination added to only ONE nav
// model is invisible to every production user while looking perfectly correct
// in the workspace IA. A utility that lives outside BOTH menus is structurally
// immune to that gap — but only while it is genuinely absent from both, under
// every flag combination, rather than absent from the one the author happened
// to open.

/** Every combination of the flags that can restructure the menu. */
function everyFlagCombination(): NavFlags[] {
  const keys = [
    "risk_workspace",
    "briefing",
    "asset_registry",
    "enterprise_context",
    "risk_intelligence",
  ] as const;
  const out: NavFlags[] = [];
  for (let mask = 0; mask < 1 << keys.length; mask++) {
    const flags: Record<string, boolean> = {};
    keys.forEach((k, i) => {
      flags[k] = Boolean(mask & (1 << i));
    });
    out.push(flags as NavFlags);
  }
  return out;
}

describe("GLOBAL_UTILITY_ITEMS — Search and Ask are utilities, not navigation", () => {
  it("declares exactly Search and Ask SecureLogic, both platform-tier", () => {
    expect(GLOBAL_UTILITY_ITEMS).toEqual([
      { label: "Search", href: "/search", access: "platform" },
      { label: "Ask SecureLogic", href: "/ask", access: "platform" },
    ]);
  });

  it("neither appears in EITHER nav model, under any flag combination", () => {
    // The prod-gap guard. A fully-entitled platform admin is used deliberately:
    // if the hrefs are absent even for the user who can see the most, they are
    // absent for everyone, and the absence is structural rather than an
    // entitlement filter that a future tier change could undo.
    for (const flags of everyFlagCombination()) {
      const rendered = allHrefs(filterNav(getNavItems(flags), true, true, true, flags));
      const label = JSON.stringify(flags);
      expect(rendered, `flags=${label}`).not.toContain("/ask");
      expect(rendered, `flags=${label}`).not.toContain("/search");
    }
  });

  it("keeps them out of the raw arrays too, so no future getNavItems branch can reintroduce one", () => {
    for (const model of [NAV_ITEMS, WORKSPACE_NAV_ITEMS]) {
      const hrefs = allHrefs(model);
      expect(hrefs).not.toContain("/ask");
      expect(hrefs).not.toContain("/search");
    }
  });

  it("declares the same access to the knowledge index that the route table carries", () => {
    // The utilities table and the ROUTES table are two independent inputs to the
    // Application Knowledge Index. If they disagree, Ask recommends itself to
    // orgs whose every question would 403 — the exact failure the access
    // annotation exists to prevent.
    for (const utility of GLOBAL_UTILITY_ITEMS) {
      const declared = ROUTE_ACCESS_DECLARATIONS.find((d) => d.prefix === utility.href);
      expect(declared, `${utility.href} has no ROUTE_ACCESS_DECLARATIONS entry`).toBeDefined();
      expect(declared?.access).toBe(utility.access);
    }
  });
});

describe("destination labels follow the risk_workspace flag", () => {
  it("names the workspace only when the flag actually renders it", () => {
    expect(findingsHomeLabel(true)).toBe("Operations Workspace");
    expect(findingsHomeLabel(false)).toBe("Findings");
  });

  it("does not invent a Finding Explorer the user cannot see", () => {
    expect(findingExplorerLabel(true)).toBe("Finding Explorer");
    expect(findingExplorerLabel(false)).toBe("All findings");
  });
});
