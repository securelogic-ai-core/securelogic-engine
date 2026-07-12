/**
 * /getting-started — the setup wizard's render contract.
 *
 * The wizard is the first thing a new organization sees, and it is the only surface
 * whose job is entirely made of PROMISES: five steps, each a label and a destination.
 * An engine test cannot see a single one of them. The defect class this file exists
 * for is a wizard that (a) sends the customer somewhere that isn't the canonical flow,
 * (b) grows a second, competing "add your first asset" path alongside the Asset
 * Registry (P13 exists precisely to prevent that), or (c) lies about progress —
 * flipping "All done!" before the work is done, or looping a finished org back to
 * step 1.
 *
 * Both halves of SECURELOGIC_ASSET_REGISTRY_ENABLED are asserted: dark must be the
 * byte-for-byte legacy vendor step, lit must be the asset-inventory step that launches
 * the canonical registry onboarding — never a mixed state.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import {
  renderPage,
  expectRedirect,
  signedIn,
  signedOut,
  apiKeyOnly,
  sessionStore,
  sp,
  hrefs,
  hrefOf,
} from "@/test/harness";
import { aDashboardSummary } from "@/test/fixtures";
import type { DashboardSummary } from "@/lib/api";

const api = vi.hoisted(() => ({
  getDashboardSummary: vi.fn(),
  getAssets: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import GettingStartedPage from "../page";
import NewAssetPage from "../../assets/new/page";

// ── Inventory/posture shaping ───────────────────────────────────────
// The wizard reads exactly two things off the dashboard summary: `inventory` (the
// counts that complete steps 1–4) and `posture` (which completes step 5). A helper
// that builds those from the REAL fixture keeps the summary honest.

type Counts = Partial<DashboardSummary["inventory"]>;

/** A brand-new org: nothing built, no posture computed. */
function emptyOrg(): DashboardSummary {
  return aDashboardSummary({
    inventory: {
      vendors: 0,
      ai_systems: 0,
      controls: 0,
      control_assessments: 0,
      governance_reviews: 0,
      frameworks: 0,
      risks: 0,
      obligations: 0,
    },
    posture: { overall_score: null, snapshot_date: null, overall_severity: null },
  });
}

function orgWith(counts: Counts, posture?: DashboardSummary["posture"]): DashboardSummary {
  const base = emptyOrg();
  return aDashboardSummary({
    inventory: { ...base.inventory, ...counts },
    posture: posture ?? base.posture,
  });
}

const POSTURE_EXISTS: DashboardSummary["posture"] = {
  overall_score: 67,
  overall_severity: "Moderate",
  snapshot_date: "2026-06-01T00:00:00.000Z",
};

/** Every step done under the LEGACY (registry-dark) rules: a vendor completes step 2. */
const LEGACY_ALL_DONE = () =>
  orgWith({ frameworks: 1, vendors: 1, controls: 1, control_assessments: 1 }, POSTURE_EXISTS);

const assetsRead = (total: number) => ({ ok: true as const, assets: [], total, limit: 1, offset: 0 });

/** The wizard renders with no props. */
const render = () => renderPage(GettingStartedPage, {});

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  Object.assign(sessionStore.current, {
    organizationName: "Acme Health",
    onboardingCompleted: false,
  });
  api.getDashboardSummary.mockResolvedValue(emptyOrg());
  api.getAssets.mockResolvedValue(assetsRead(0));
});

// ─────────────────────────────────────────────────────────────────────
// 1. The steps, and where they go
// ─────────────────────────────────────────────────────────────────────

describe("/getting-started — the five steps and their destinations (registry DARK)", () => {
  beforeEach(() => vi.stubEnv("SECURELOGIC_ASSET_REGISTRY_ENABLED", "false"));

  it("renders the five real steps, in order, under the org's name", async () => {
    const { container } = await render();

    expect(screen.getByText("Welcome to SecureLogic AI")).toBeInTheDocument();
    expect(screen.getByText(/Acme Health's security program starts here\./)).toBeInTheDocument();

    // Order is the contract: the checklist teaches a sequence (framework → vendor →
    // control → assessment → posture). A reshuffle would leave step 5 depending on
    // work the customer hasn't been asked to do yet.
    const titles = Array.from(container.querySelectorAll("p.font-semibold")).map((p) =>
      p.textContent?.trim()
    );
    expect(titles).toEqual([
      "Activate a framework",
      "Add your first vendor",
      "Add a security control",
      "Run an assessment",
      "Review your security posture",
    ]);

    // And they are NUMBERED in that order — the badge is how the customer reads progress.
    expect(
      Array.from(container.querySelectorAll("p.text-xs.mb-0\\.5")).map((p) => p.textContent)
    ).toEqual(["Step 1", "Step 2", "Step 3", "Step 4", "Step 5"]);
  });

  it("each step's CTA routes to its real destination", async () => {
    const { container } = await render();

    expect(hrefOf(container, "Choose Framework →")).toBe("/frameworks");
    expect(hrefOf(container, "Add Vendor →")).toBe("/vendors/new");
    expect(hrefOf(container, "Add Control →")).toBe("/controls/new");
    expect(hrefOf(container, "Go to Controls →")).toBe("/controls");
    expect(hrefOf(container, "View Dashboard →")).toBe("/dashboard");
  });

  it("has no dead links — every CTA is a real route", async () => {
    const { container } = await render();

    const all = hrefs(container);
    expect(all.length).toBe(5);
    for (const href of all) {
      expect(href).not.toBe("");
      expect(href).not.toBe("#");
      expect(href.startsWith("/")).toBe(true);
    }
  });

  it("always offers the escape hatch — setup is skippable, not a trap", async () => {
    await render();
    expect(screen.getByRole("button", { name: /Skip setup for now/ })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. The Asset Registry flag — both ways, no mixed state
// ─────────────────────────────────────────────────────────────────────

describe("/getting-started — SECURELOGIC_ASSET_REGISTRY_ENABLED", () => {
  it("OFF: step 2 is the legacy vendor step, and the dark /api/assets is never called", async () => {
    vi.stubEnv("SECURELOGIC_ASSET_REGISTRY_ENABLED", "false");

    const { container } = await render();

    expect(screen.getByText("Add your first vendor")).toBeInTheDocument();
    expect(screen.queryByText("Build your asset inventory")).toBeNull();
    expect(hrefs(container)).toContain("/vendors/new");
    expect(hrefs(container)).not.toContain("/assets/new");

    // The engine 404s /api/assets while the registry is dark. Reading it anyway would
    // make the wizard's read path depend on an endpoint that isn't there.
    expect(api.getAssets).not.toHaveBeenCalled();
  });

  it("ON: step 2 becomes the asset-inventory step and the legacy vendor step is GONE", async () => {
    vi.stubEnv("SECURELOGIC_ASSET_REGISTRY_ENABLED", "true");

    const { container } = await render();

    expect(screen.getByText("Build your asset inventory")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Add assets manually, import from CSV, or connect enterprise systems — vendors and AI systems are asset types in your registry."
      )
    ).toBeInTheDocument();

    // Not a sixth step, and not a second vendor path: it REPLACES step 2.
    expect(screen.queryByText("Add your first vendor")).toBeNull();
    expect(hrefs(container)).not.toContain("/vendors/new");
    expect(screen.getByText(/5 steps complete/)).toBeInTheDocument();

    expect(api.getAssets).toHaveBeenCalledWith(expect.anything(), { limit: 1 });
  });

  it("ON: step 2 launches the CANONICAL registry onboarding route, not a wizard-owned one", async () => {
    vi.stubEnv("SECURELOGIC_ASSET_REGISTRY_ENABLED", "true");

    const { container } = await render();

    // /assets/new is the Asset Registry's own create/onboarding surface. Any other
    // destination (a /getting-started/assets, a bespoke picker) would be the wizard
    // re-implementing onboarding — the exact thing P13 removed.
    expect(hrefOf(container, "Open Asset Registry →")).toBe("/assets/new");
    expect(hrefs(container).some((h) => h.startsWith("/getting-started"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Create / Import / Connect — offered once, by the canonical surface
// ─────────────────────────────────────────────────────────────────────

describe("the wizard's onboarding methods are the Asset Registry's", () => {
  it("the wizard presents exactly ONE way into asset onboarding — no competing path", async () => {
    vi.stubEnv("SECURELOGIC_ASSET_REGISTRY_ENABLED", "true");

    const { container } = await render();
    const all = hrefs(container);

    // A second destination for the same outcome (an inline importer link, a connector
    // link, a vendor form) would give the customer two "add your first asset" paths
    // with different validation, caps and dedup. One door only.
    expect(all.filter((h) => h.startsWith("/assets")).length).toBe(1);
    expect(all).toContain("/assets/new");
    expect(all).not.toContain("/assets/import");
    expect(all).not.toContain("/assets/connect");
    expect(all).not.toContain("/vendors/new");
    expect(all).not.toContain("/ai-systems/new");
  });

  it("the destination it hands off to offers all three methods, each to a real route", async () => {
    vi.stubEnv("SECURELOGIC_ASSET_REGISTRY_ENABLED", "true");
    vi.stubEnv("SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED", "true");

    // The handoff is only worth anything if the thing on the other side is the real
    // three-method onboarding. Render the wizard's step-2 destination and prove it.
    const { container } = await renderPage(NewAssetPage, { searchParams: sp({}) });

    expect(screen.getByText(/1 · Create manually/)).toBeInTheDocument();
    expect(screen.getByText(/2 · Bulk upload/)).toBeInTheDocument();
    expect(screen.getByText(/3 · Connect enterprise systems/)).toBeInTheDocument();

    const all = hrefs(container);
    // create → the federated per-type routes (native + authoritative screens)
    expect(all).toContain("/assets/new?type=cloud_resource");
    expect(all).toContain("/vendors/new?from=registry");
    expect(all).toContain("/ai-systems/new?from=registry");
    // import → the existing importer, connect → the existing connector catalog
    expect(hrefOf(container, "Upload CSV / XLSX →")).toBe("/assets/import");
    expect(hrefOf(container, "Browse connectors →")).toBe("/assets/connect");

    for (const href of all) {
      expect(href).not.toBe("");
      expect(href).not.toBe("#");
    }
  });

  it("the destination is honest when the registry is dark — it does not offer methods it cannot serve", async () => {
    vi.stubEnv("SECURELOGIC_ASSET_REGISTRY_ENABLED", "false");

    const { container } = await renderPage(NewAssetPage, { searchParams: sp({}) });

    // The wizard never links here while dark (asserted above); if something else does,
    // the customer gets a neutral panel, not a broken create form.
    expect(screen.queryByText(/1 · Create manually/)).toBeNull();
    expect(
      screen.getByText("The Asset Registry isn't available for your organization yet.")
    ).toBeInTheDocument();
    expect(hrefs(container)).toEqual([]);
  });

  it("ECL flag OFF: the ECL-homed create targets are withheld rather than pointed at a dark page", async () => {
    vi.stubEnv("SECURELOGIC_ASSET_REGISTRY_ENABLED", "true");
    vi.stubEnv("SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED", "false");

    const { container } = await renderPage(NewAssetPage, { searchParams: sp({}) });

    const all = hrefs(container);
    expect(all.some((h) => h.startsWith("/enterprise-context"))).toBe(false);
    // The two non-ECL federated screens survive, so create/import/connect all still work.
    expect(all).toContain("/vendors/new?from=registry");
    expect(hrefOf(container, "Upload CSV / XLSX →")).toBe("/assets/import");
    expect(hrefOf(container, "Browse connectors →")).toBe("/assets/connect");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. Progress, resume, completion
// ─────────────────────────────────────────────────────────────────────

describe("/getting-started — progress and resume", () => {
  it("a brand-new org starts at 0 of 5 with every CTA live", async () => {
    vi.stubEnv("SECURELOGIC_ASSET_REGISTRY_ENABLED", "false");

    const { container } = await render();

    expect(screen.getByText("0 of 5 steps complete")).toBeInTheDocument();
    expect(screen.queryByText("All done!")).toBeNull();
    expect(screen.queryByRole("button", { name: /Go to your dashboard/ })).toBeNull();
    expect(hrefs(container).length).toBe(5);
    expect(screen.queryAllByText("Done ✓")).toHaveLength(0);
  });

  it("a partially-complete org resumes at the first UNFINISHED step and marks the rest done", async () => {
    vi.stubEnv("SECURELOGIC_ASSET_REGISTRY_ENABLED", "false");
    api.getDashboardSummary.mockResolvedValue(orgWith({ frameworks: 1, vendors: 2 }));

    const { container } = await render();

    expect(screen.getByText("2 of 5 steps complete")).toBeInTheDocument();
    expect(screen.getAllByText("Done ✓")).toHaveLength(2);

    // A completed step shows "Done ✓" INSTEAD of its CTA — re-offering "Choose
    // Framework" to an org that already has one is how a wizard loses a customer's trust.
    expect(hrefOf(container, "Choose Framework →")).toBeNull();
    expect(hrefOf(container, "Add Vendor →")).toBeNull();

    // …and the work that remains is still one click away, starting where they left off.
    expect(hrefOf(container, "Add Control →")).toBe("/controls/new");
    expect(hrefOf(container, "Go to Controls →")).toBe("/controls");
    expect(hrefOf(container, "View Dashboard →")).toBe("/dashboard");
  });

  it("running the first assessment does NOT flip the wizard to 'All done!' — posture must exist", async () => {
    vi.stubEnv("SECURELOGIC_ASSET_REGISTRY_ENABLED", "false");
    api.getDashboardSummary.mockResolvedValue(
      orgWith({ frameworks: 1, vendors: 1, controls: 1, control_assessments: 1 })
    );

    const { container } = await render();

    // The old bug: steps 4 and 5 were both keyed to control_assessments, so 3 → 5 and
    // "All done!" appeared before any posture had been computed, let alone reviewed.
    expect(screen.getByText("4 of 5 steps complete")).toBeInTheDocument();
    expect(screen.queryByText("All done!")).toBeNull();
    expect(hrefOf(container, "View Dashboard →")).toBe("/dashboard");
  });

  it("a fully-complete org gets the real completion state, not another checklist to click", async () => {
    vi.stubEnv("SECURELOGIC_ASSET_REGISTRY_ENABLED", "false");
    api.getDashboardSummary.mockResolvedValue(LEGACY_ALL_DONE());

    const { container } = await render();

    expect(screen.getByText("5 of 5 steps complete")).toBeInTheDocument();
    expect(screen.getByText("All done!")).toBeInTheDocument();
    expect(screen.getAllByText("Done ✓")).toHaveLength(5);
    expect(screen.getByRole("button", { name: /Go to your dashboard →/ })).toBeInTheDocument();
    // Nothing left to click into: every CTA has been replaced by its done marker.
    expect(hrefs(container)).toEqual([]);
  });

  it("registry ON: step 2 completes on a REGISTRY ASSET, not on a legacy vendor row", async () => {
    vi.stubEnv("SECURELOGIC_ASSET_REGISTRY_ENABLED", "true");
    // 8 vendors, zero registry assets: under the lit registry the customer has not yet
    // built an inventory, and the wizard must not congratulate them for it.
    api.getDashboardSummary.mockResolvedValue(LEGACY_ALL_DONE());
    api.getAssets.mockResolvedValue(assetsRead(0));

    const { container } = await render();

    expect(screen.getByText("4 of 5 steps complete")).toBeInTheDocument();
    expect(screen.queryByText("All done!")).toBeNull();
    expect(hrefOf(container, "Open Asset Registry →")).toBe("/assets/new");
  });

  it("registry ON: one asset in the registry completes step 2", async () => {
    vi.stubEnv("SECURELOGIC_ASSET_REGISTRY_ENABLED", "true");
    api.getDashboardSummary.mockResolvedValue(LEGACY_ALL_DONE());
    api.getAssets.mockResolvedValue(assetsRead(1));

    const { container } = await render();

    expect(screen.getByText("5 of 5 steps complete")).toBeInTheDocument();
    expect(screen.getByText("All done!")).toBeInTheDocument();
    expect(hrefOf(container, "Open Asset Registry →")).toBeNull();
  });

  it("an already-onboarded org is sent to the dashboard — never looped back to step 1", async () => {
    vi.stubEnv("SECURELOGIC_ASSET_REGISTRY_ENABLED", "true");
    Object.assign(sessionStore.current, { onboardingCompleted: true });

    expect(await expectRedirect(GettingStartedPage, {})).toBe("/dashboard");
    expect(api.getDashboardSummary).not.toHaveBeenCalled();
  });

  it("a failed summary read shows an honest empty checklist, not a fabricated one", async () => {
    vi.stubEnv("SECURELOGIC_ASSET_REGISTRY_ENABLED", "false");
    api.getDashboardSummary.mockResolvedValue(null);

    await render();

    // A read failure is not completion (#637's lesson, applied to onboarding).
    expect(screen.getByText("0 of 5 steps complete")).toBeInTheDocument();
    expect(screen.queryByText("All done!")).toBeNull();
  });

  it("registry ON but the assets read FAILS: step 2 stays incomplete", async () => {
    vi.stubEnv("SECURELOGIC_ASSET_REGISTRY_ENABLED", "true");
    api.getDashboardSummary.mockResolvedValue(LEGACY_ALL_DONE());
    api.getAssets.mockResolvedValue({ ok: false, disabled: true, error: "not_found" });

    const { container } = await render();

    expect(screen.getByText("4 of 5 steps complete")).toBeInTheDocument();
    expect(hrefOf(container, "Open Asset Registry →")).toBe("/assets/new");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. Authorization
// ─────────────────────────────────────────────────────────────────────

describe("/getting-started — authorization", () => {
  it("sends a signed-out visitor to /login", async () => {
    vi.stubEnv("SECURELOGIC_ASSET_REGISTRY_ENABLED", "false");
    signedOut();

    expect(await expectRedirect(GettingStartedPage, {})).toBe("/login");
    expect(api.getDashboardSummary).not.toHaveBeenCalled();
  });

  it("an API-key caller (no user identity) still gets the checklist", async () => {
    vi.stubEnv("SECURELOGIC_ASSET_REGISTRY_ENABLED", "false");
    apiKeyOnly();

    await render();

    // Real behavior: the wizard authorizes on EITHER token, and falls back to a neutral
    // org label when the session carries no organizationName.
    expect(screen.getByText(/Your organization's security program starts here\./)).toBeInTheDocument();
    expect(screen.getByText("0 of 5 steps complete")).toBeInTheDocument();
  });

  it("the wizard itself is NOT entitlement-gated — a free-tier org sees the same checklist", async () => {
    vi.stubEnv("SECURELOGIC_ASSET_REGISTRY_ENABLED", "false");
    signedIn({ entitlementLevel: "free" });

    const { container } = await render();

    // Asserting what the code ACTUALLY does. Note the consequence, which is the same on
    // both sides of the registry flag: the step-2 CTA (/vendors/new dark, /assets/new
    // lit) is platform-gated at its destination, so a free-tier caller who clicks it is
    // redirected to /dashboard. The wizard shows no gated state for that.
    expect(screen.getByText("0 of 5 steps complete")).toBeInTheDocument();
    expect(hrefs(container)).toContain("/vendors/new");
  });
});
