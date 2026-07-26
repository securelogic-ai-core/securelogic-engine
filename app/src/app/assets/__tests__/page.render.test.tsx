/**
 * /assets — the Asset Registry render contract.
 *
 * The registry is the SINGLE canonical surface for every asset type (EAR P12 /
 * EAR-AD-1). Three defect classes this file exists to catch, none of which an
 * engine test can see because the engine never renders an href:
 *
 *   1. A SECOND competing Assets destination in the nav — the customer is offered
 *      two "where do my assets live" answers and the registry stops being canonical.
 *   2. A link that DROPS an active filter — clicking "Next" under an "AI System"
 *      filter silently widens the population back to every asset type, and the
 *      count the customer was reading changes underneath them.
 *   3. A FAKE ZERO — the registry read fails (dark flag / missing capability) and
 *      the page renders "0 assets" + an empty state, telling an org with a full
 *      inventory that it has none.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, expectRedirect, signedIn, signedOut, apiKeyOnly, sp, hrefs, hrefOf } from "@/test/harness";
import { aCanonicalAsset } from "@/test/fixtures";
import { ASSET_TYPES, assetTypeLabel } from "@/lib/assetRegistry";
import { NAV_ITEMS, WORKSPACE_NAV_ITEMS, filterNav, type NavItem } from "@/lib/navigation";

const api = vi.hoisted(() => ({
  getAssets: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import AssetsPage from "../page";

const ASSETS = [
  aCanonicalAsset({ asset_id: "as-1", name: "prod-eu-west-1 S3 backups", asset_type: "cloud_resource" }),
  aCanonicalAsset({
    asset_id: "as-2",
    name: "Acme Cloud",
    asset_type: "vendor",
    backing_kind: "vendors",
    backing_id: "v-9",
  }),
];

const okAssets = (assets = ASSETS, total = assets.length) => ({
  ok: true as const,
  assets,
  total,
  limit: 25,
  offset: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getAssets.mockResolvedValue(okAssets());
});

// ── 1 · The canonical Assets navigation ──────────────────────────────
//
// The registry's whole claim is that it is the ONE place assets live. That claim is
// made in the nav, not on the page, so it is asserted against the real nav model.

/** Every destination in the nav that is an asset-inventory listing. */
const INVENTORY_HREFS = ["/assets", "/vendors", "/ai-systems"];

function assetsGroupHrefs(items: NavItem[]): string[] {
  const group = items.find((i) => i.type === "group" && i.label === "Assets");
  if (!group || group.type !== "group") return [];
  return group.items.map((c) => c.href);
}

describe.each([
  ["legacy nav", NAV_ITEMS],
  ["workspace nav", WORKSPACE_NAV_ITEMS],
])("the Assets nav (%s) — one canonical entry", (_name, items) => {
  it("flag ON exposes exactly ONE asset-inventory destination: the Asset Registry", () => {
    const visible = filterNav(items, true, true, true, { asset_registry: true });
    const children = assetsGroupHrefs(visible);

    // Vendors and AI Systems are asset TYPES inside the registry now, not rival
    // menu destinations. Two inventory entries = two answers to "where are my
    // assets", which is precisely what P12 removed.
    expect(children.filter((h) => INVENTORY_HREFS.includes(h))).toEqual(["/assets"]);
    expect(children).not.toContain("/vendors");
    expect(children).not.toContain("/ai-systems");
  });

  it("flag OFF is the LEGACY menu — the registry is dark, and never mixed with it", () => {
    const visible = filterNav(items, true, true, true);
    const children = assetsGroupHrefs(visible);

    // Fail-closed: the registry entry ships in code but stays invisible while dark.
    expect(children).not.toContain("/assets");
    // …and the legacy destinations are still the menu, so the dropdown is not empty.
    expect(children).toContain("/vendors");
    expect(children).toContain("/ai-systems");
  });

  it("is platform-gated — a Brief-tier user is offered no Assets menu at all", () => {
    const visible = filterNav(items, false, true, false, { asset_registry: true });
    expect(assetsGroupHrefs(visible)).toEqual([]);
  });
});

// ── 2 · Type filters ─────────────────────────────────────────────────

describe("/assets — the asset-type filters", () => {
  it("renders every real asset type with its real label, plus All", async () => {
    const { container } = await renderPage(AssetsPage, { searchParams: sp({}) });

    for (const t of ASSET_TYPES) {
      const label = assetTypeLabel(t);
      const href = hrefOf(container, new RegExp(`^${label}$`));
      expect(href, `filter chip missing for ${t}`).toBe(`/assets?asset_type=${t}`);
    }
    expect(hrefOf(container, /^All$/)).toBe("/assets");
  });

  it("an active filter is applied to the engine read, not just painted on the chip", async () => {
    await renderPage(AssetsPage, { searchParams: sp({ asset_type: "ai_system" }) });

    expect(api.getAssets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ asset_type: "ai_system" })
    );
  });

  it("an unknown asset_type is ignored, not passed through to the engine", async () => {
    await renderPage(AssetsPage, { searchParams: sp({ asset_type: "unicorn" }) });

    const params = api.getAssets.mock.calls[0][1];
    expect(params.asset_type).toBeUndefined();
  });

  it("PAGINATION preserves the active type filter — Next must not widen the population", async () => {
    // 40 assets under an AI-System filter → a Next link exists.
    api.getAssets.mockResolvedValue(okAssets(ASSETS, 40));

    const { container } = await renderPage(AssetsPage, {
      searchParams: sp({ asset_type: "ai_system" }),
    });

    const next = hrefOf(container, /Next/);
    // THE DEFECT: a page link built without the filter sends the customer to page 2
    // of EVERY asset type, under a chip that still says "AI System".
    expect(next).toContain("asset_type=ai_system");
    expect(next).toContain("offset=25");
  });

  it("Previous also carries the filter, and page 1 drops the offset param entirely", async () => {
    api.getAssets.mockResolvedValue({ ...okAssets(ASSETS, 40), offset: 25 });

    const { container } = await renderPage(AssetsPage, {
      searchParams: sp({ asset_type: "endpoint", offset: "25" }),
    });

    const prev = hrefOf(container, /Previous/);
    expect(prev).toContain("asset_type=endpoint");
    expect(prev).not.toContain("offset"); // back to page 1 = no stale offset
  });

  it("switching the type filter RESETS paging — a filter chip never carries a stale offset", async () => {
    api.getAssets.mockResolvedValue({ ...okAssets(ASSETS, 40), offset: 25 });

    const { container } = await renderPage(AssetsPage, {
      searchParams: sp({ asset_type: "endpoint", offset: "25" }),
    });

    // Page 2 of endpoints → click "API": a chip carrying offset=25 would land on an
    // empty page of a population that only has three rows. Honest reset instead.
    expect(hrefOf(container, /^API$/)).toBe("/assets?asset_type=api");
    expect(hrefOf(container, /^All$/)).toBe("/assets");
  });

  it("the count line names the filtered population, so a smaller number is explained", async () => {
    api.getAssets.mockResolvedValue(okAssets([ASSETS[0]], 1));

    await renderPage(AssetsPage, { searchParams: sp({ asset_type: "cloud_resource" }) });

    expect(screen.getByText(/1 asset · Cloud Resource/)).toBeInTheDocument();
  });
});

// ── 2b · Search ──────────────────────────────────────────────────────
//
// Assets adopts the platform list-page search pattern (as on the Finding surface):
// a SEARCH label + input + button above the filters, submitted as a URL param so it
// composes with the filters and survives pagination — no client state.

describe("/assets — the search section", () => {
  it("renders the SEARCH label, the input with the Phase-1 placeholder, and a Search button", async () => {
    await renderPage(AssetsPage, { searchParams: sp({}) });

    // Uppercase section label consistent with the "Risk" filter label. (The button
    // also reads "Search", so pin this assertion to the <label>.)
    expect(screen.getByText("Search", { selector: "label" })).toBeInTheDocument();
    // The placeholder names only fields the engine actually searches today —
    // no promising identifiers (alias, IP) the schema does not hold.
    expect(
      screen.getByPlaceholderText("Name, asset ID, hostname, cloud account, vendor, business process..."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  });

  it("an active search is applied to the engine read, not just painted in the box", async () => {
    await renderPage(AssetsPage, { searchParams: sp({ q: "acme" }) });

    expect(api.getAssets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ q: "acme" }),
    );
    // …and the box echoes the active term so the customer sees what they searched.
    expect(
      screen.getByPlaceholderText(/Name, asset ID/),
    ).toHaveValue("acme");
  });

  it("a blank / whitespace-only search is ignored, not passed to the engine", async () => {
    await renderPage(AssetsPage, { searchParams: sp({ q: "   " }) });

    const params = api.getAssets.mock.calls[0][1];
    expect(params.q).toBeUndefined();
  });

  it("out-of-bounds terms are not sent — the engine's 2–120 bounds are respected up front", async () => {
    // A 1-char term or an over-long one must not reach getAssets: sending it
    // would 400 the read and the page would render a failure panel over a
    // registry that is actually fine.
    for (const bad of ["a", "a".repeat(121)]) {
      vi.clearAllMocks();
      signedIn();
      api.getAssets.mockResolvedValue(okAssets());
      await renderPage(AssetsPage, { searchParams: sp({ q: bad }) });
      expect(api.getAssets.mock.calls[0][1].q).toBeUndefined();
    }
  });

  it("the search form submits a GET to /assets and carries the active filters as hidden inputs", async () => {
    const { container } = await renderPage(AssetsPage, {
      searchParams: sp({ asset_type: "ai_system", at_risk: "true", q: "acme" }),
    });

    const form = container.querySelector("form[action='/assets']") as HTMLFormElement;
    expect(form).not.toBeNull();
    expect(form.getAttribute("method")).toBe("get");
    // A new search must not silently drop the filters the customer already applied…
    expect(form.querySelector("input[name='asset_type'][value='ai_system']")).not.toBeNull();
    expect(form.querySelector("input[name='at_risk'][value='true']")).not.toBeNull();
    // …but it must NOT carry a stale offset — a new search honestly resets to page 1.
    expect(form.querySelector("input[name='offset']")).toBeNull();
  });

  it("the filter chips PRESERVE the active search — refining type must not drop the query", async () => {
    const { container } = await renderPage(AssetsPage, { searchParams: sp({ q: "acme" }) });

    expect(hrefOf(container, /^All$/)).toBe("/assets?q=acme");
    expect(hrefOf(container, new RegExp(`^${assetTypeLabel("ai_system")}$`))).toContain("q=acme");
    expect(hrefOf(container, /^At risk$/)).toContain("q=acme");
  });

  it("PAGINATION preserves the active search — Next must not widen the population", async () => {
    api.getAssets.mockResolvedValue(okAssets(ASSETS, 40));

    const { container } = await renderPage(AssetsPage, { searchParams: sp({ q: "acme" }) });

    const next = hrefOf(container, /Next/);
    expect(next).toContain("q=acme");
    expect(next).toContain("offset=25");
  });

  it("an empty search result says so — it does not claim the registry is empty", async () => {
    api.getAssets.mockResolvedValue(okAssets([], 0));

    await renderPage(AssetsPage, { searchParams: sp({ q: "nomatch" }) });

    expect(screen.getByText(/No assets match your search/i)).toBeInTheDocument();
    expect(screen.queryByText(/No assets registered yet/)).not.toBeInTheDocument();
  });
});

// ── 3 · Rows and federation ──────────────────────────────────────────

describe("/assets — the rows", () => {
  it("renders the assets the engine returned, each linked to its authoritative page", async () => {
    const { container } = await renderPage(AssetsPage, { searchParams: sp({}) });

    // Detail-backed asset → homed on the unified surface.
    expect(hrefOf(container, /prod-eu-west-1 S3 backups/)).toBe("/assets/as-1");
    // Vendor-backed asset → federates out to the vendor's own page (EAR-AD-1),
    // keyed by the BACKING id, not the registry id.
    expect(hrefOf(container, /Acme Cloud/)).toBe("/vendors/v-9");
  });

  it("offers no dead links anywhere on the page", async () => {
    const { container } = await renderPage(AssetsPage, { searchParams: sp({}) });

    const all = hrefs(container);
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((h) => h === "#" || h.trim() === "")).toEqual([]);
  });
});

// ── 4 · Create entry point ───────────────────────────────────────────

describe("/assets — the create entry point", () => {
  it("with no filter, Add asset opens the onboarding surface (type not yet chosen)", async () => {
    const { container } = await renderPage(AssetsPage, { searchParams: sp({}) });

    expect(hrefOf(container, /Add asset/)).toBe("/assets/new");
  });

  it("with a type filter, Add goes STRAIGHT to that type's create screen — the type is not re-picked", async () => {
    const { container } = await renderPage(AssetsPage, {
      searchParams: sp({ asset_type: "cloud_resource" }),
    });

    expect(hrefOf(container, /Add Cloud Resource/)).toBe("/assets/new?type=cloud_resource");
  });

  it("a federated type's Add opens its authoritative screen, framed as a registry flow", async () => {
    const { container } = await renderPage(AssetsPage, { searchParams: sp({ asset_type: "vendor" }) });

    expect(hrefOf(container, /Add Vendor/)).toBe("/vendors/new?from=registry");
  });
});

// ── 5 · Empty state ──────────────────────────────────────────────────

describe("/assets — the empty state", () => {
  it("is a guided next step, not a dead end", async () => {
    api.getAssets.mockResolvedValue(okAssets([], 0));

    const { container } = await renderPage(AssetsPage, { searchParams: sp({}) });

    expect(screen.getByText(/No assets registered yet/)).toBeInTheDocument();
    // The whole point: an empty registry must offer the way OUT of empty.
    expect(hrefOf(container, /Add asset/)).toBe("/assets/new");
    // …and it must name the real onboarding methods, not just "add one".
    expect(screen.getByText(/import from an\s+existing source/i)).toBeInTheDocument();
  });

  it("an empty FILTERED view says which population is empty and offers that type's create", async () => {
    api.getAssets.mockResolvedValue(okAssets([], 0));

    const { container } = await renderPage(AssetsPage, {
      searchParams: sp({ asset_type: "identity_system" }),
    });

    expect(screen.getByText(/No identity system assets yet/i)).toBeInTheDocument();
    expect(hrefOf(container, /Add Identity System/)).toBe("/assets/new?type=identity_system");
    // The filter chips stay, so "empty" is visibly a filtered empty — the customer
    // can widen back to All rather than concluding the registry is empty.
    expect(hrefOf(container, /^All$/)).toBe("/assets");
  });
});

// ── 6 · Dark / disabled / capability — the fake-zero guard ────────────
//
// The list page has no env branch of its own: the ENGINE 404s /api/assets while
// SECURELOGIC_ASSET_REGISTRY_ENABLED is off, and 403s `capability_required` for an
// org without the capability (the two-switch model — the nav flag above is the app
// half). getAssets turns both into a failed read, and THAT is the branch the page
// takes. So the flag-off branch is modelled here as the engine response it produces.

describe("/assets — flag OFF (engine 404s the dark route)", () => {
  const disabled = { ok: false as const, disabled: true, error: "not_found" };

  it("renders the honest 'not available' panel — never a registry, never a fake zero", async () => {
    api.getAssets.mockResolvedValue(disabled);

    const { container } = await renderPage(AssetsPage, { searchParams: sp({}) });

    expect(screen.getByText(/isn't available for your organization yet/i)).toBeInTheDocument();
    // THE DEFECT: falling through to the empty state would tell an org with a full
    // inventory that it has zero assets.
    expect(screen.queryByText(/No assets registered yet/)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\b0 assets\b/);
  });

  it("shows no registry chrome at all — no filters, no Add, no mixed state", async () => {
    api.getAssets.mockResolvedValue(disabled);

    const { container } = await renderPage(AssetsPage, { searchParams: sp({}) });

    expect(hrefOf(container, /^All$/)).toBeNull();
    expect(hrefOf(container, /Add asset/)).toBeNull();
    expect(hrefs(container).filter((h) => h.startsWith("/assets?"))).toEqual([]);
  });
});

describe("/assets — the caller is not entitled", () => {
  it("a signed-out visitor is sent to /login", async () => {
    signedOut();
    expect(await expectRedirect(AssetsPage, { searchParams: sp({}) })).toBe("/login");
  });

  it("a Brief-tier (non-platform) user is sent to /dashboard, not into the registry", async () => {
    signedIn({ entitlementLevel: "professional" });
    expect(await expectRedirect(AssetsPage, { searchParams: sp({}) })).toBe("/dashboard");
    expect(api.getAssets).not.toHaveBeenCalled();
  });

  it("an API-key caller with no entitlement on the session is sent to /dashboard", async () => {
    apiKeyOnly();
    expect(await expectRedirect(AssetsPage, { searchParams: sp({}) })).toBe("/dashboard");
  });

  it.each(["platform", "team", "premium"])("a %s user is let into the registry", async (level) => {
    signedIn({ entitlementLevel: level });
    await renderPage(AssetsPage, { searchParams: sp({}) });
    expect(screen.getByText(/prod-eu-west-1 S3 backups/)).toBeInTheDocument();
  });

  it("an org WITHOUT the capability gets the gated affordance and a route to plans", async () => {
    api.getAssets.mockResolvedValue({ ok: false, disabled: false, error: "capability_required" });

    const { container } = await renderPage(AssetsPage, { searchParams: sp({}) });

    expect(screen.getByText(/doesn't have access to the Asset Registry/i)).toBeInTheDocument();
    expect(screen.getByText(/part of the Platform plans/i)).toBeInTheDocument();
    expect(hrefOf(container, /see plans/)).toBe("/pricing");
    expect(container.textContent).not.toMatch(/\b0 assets\b/);
  });

  it("a transport failure is an error, not an empty registry", async () => {
    api.getAssets.mockResolvedValue({ ok: false, disabled: false, error: "network_error" });

    const { container } = await renderPage(AssetsPage, { searchParams: sp({}) });

    expect(screen.getByText(/Something went wrong loading assets/i)).toBeInTheDocument();
    expect(screen.queryByText(/No assets registered yet/)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\b0 assets\b/);
  });
});
