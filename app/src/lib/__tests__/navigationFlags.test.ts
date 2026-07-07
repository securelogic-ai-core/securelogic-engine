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

  it("the real NAV_ITEMS Asset Registry entry is dark by default and independent of the ECL flag", () => {
    const dark = filterNav(NAV_ITEMS, true, true, true);
    expect(dark.some((i) => "href" in i && i.href === "/assets")).toBe(false);
    // The ECL flag alone must NOT reveal it (two independent switches).
    const eclOnly = filterNav(NAV_ITEMS, true, true, true, { enterprise_context: true });
    expect(eclOnly.some((i) => "href" in i && i.href === "/assets")).toBe(false);
    const withFlag = filterNav(NAV_ITEMS, true, true, true, { asset_registry: true });
    expect(withFlag.some((i) => "href" in i && i.href === "/assets")).toBe(true);
    // Flag on but not a platform user → still hidden by the entitlement gate.
    const notPlatform = filterNav(NAV_ITEMS, false, true, false, { asset_registry: true });
    expect(notPlatform.some((i) => "href" in i && i.href === "/assets")).toBe(false);
  });
});
