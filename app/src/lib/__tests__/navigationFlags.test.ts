import { describe, it, expect } from "vitest";
import { NAV_ITEMS, filterNav, type NavItem } from "../navigation";

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

  it("the Asset Registry is a dark-by-default CHILD of the Assets group (EAR P12 canonical surface)", () => {
    // While dark, the Assets dropdown is byte-identical to the legacy menu.
    const dark = filterNav(NAV_ITEMS, true, true, true);
    expect(assetsGroupChildren(dark)).toEqual(["/vendors", "/ai-systems"]);

    // The ECL flag alone must NOT reveal it (two independent switches).
    const eclOnly = filterNav(NAV_ITEMS, true, true, true, { enterprise_context: true });
    expect(assetsGroupChildren(eclOnly)).toEqual(["/vendors", "/ai-systems"]);

    // With its own flag on, "Asset Registry" appears FIRST — the canonical
    // destination — with Vendors / AI Systems beneath it as asset types.
    const withFlag = filterNav(NAV_ITEMS, true, true, true, { asset_registry: true });
    expect(assetsGroupChildren(withFlag)).toEqual(["/assets", "/vendors", "/ai-systems"]);

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
