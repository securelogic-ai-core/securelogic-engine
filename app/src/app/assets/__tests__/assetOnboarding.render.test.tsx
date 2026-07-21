/**
 * /assets/new, /assets/import, /assets/connect — the three canonical onboarding
 * methods of the Asset Registry (EAR P15/P16).
 *
 * The contract: a customer who has no assets yet is offered CREATE, IMPORT, and
 * CONNECT on one surface, each routed to a REAL destination that already exists.
 * The defect classes:
 *   - a method advertised but wired to nothing (href="#", "coming soon");
 *   - a method pointed at a DARK page (an ECL-backed create/import offered while
 *     the Enterprise Context flag is off → the customer clicks into a 404);
 *   - a flag-off surface that renders the registry chrome anyway (mixed state).
 *
 * Unlike the /assets list (whose dark branch comes from the engine's 404), these
 * three pages read SECURELOGIC_ASSET_REGISTRY_ENABLED themselves — so both
 * branches are driven here with vi.stubEnv.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, expectRedirect, signedIn, signedOut, sp, hrefs, hrefOf } from "@/test/harness";
import { anOrgConnector } from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getConnectors: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import NewAssetPage from "../new/page";
import AssetImportPage from "../import/page";
import ConnectAssetsPage from "../connect/page";

const on = () => vi.stubEnv("SECURELOGIC_ASSET_REGISTRY_ENABLED", "true");
const off = () => vi.stubEnv("SECURELOGIC_ASSET_REGISTRY_ENABLED", "false");
const eclOn = () => vi.stubEnv("SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED", "true");
const eclOff = () => vi.stubEnv("SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED", "false");

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getConnectors.mockResolvedValue({ ok: true, connectors: [anOrgConnector()] });
});

// ── /assets/new — the create surface offers all three methods ─────────

describe("/assets/new — the three onboarding methods", () => {
  it("offers CREATE, IMPORT and CONNECT as co-equal, first-class methods", async () => {
    on();
    eclOff();

    await renderPage(NewAssetPage, { searchParams: sp({}) });

    // The real labels, from assetOnboardingMethods() — a customer with an empty
    // registry must be able to see all three ways in.
    expect(screen.getByText(/Create manually/)).toBeInTheDocument();
    expect(screen.getByText(/Bulk upload/)).toBeInTheDocument();
    expect(screen.getByText(/Connect enterprise systems/)).toBeInTheDocument();
  });

  it("each method routes to its REAL destination — no dead links, no 'coming soon'", async () => {
    on();
    eclOff();

    const { container } = await renderPage(NewAssetPage, { searchParams: sp({}) });

    // Import + connect are fixed destinations that already exist.
    expect(hrefOf(container, /Upload a spreadsheet/)).toBe("/assets/import");
    expect(hrefOf(container, /Connect a source of truth/)).toBe("/assets/connect");
    // Create fans out per type: the four native types land on the inline form with
    // the type PRESELECTED (the type is chosen once, never re-picked downstream).
    expect(hrefOf(container, /Cloud Resource/)).toBe("/assets/new?type=cloud_resource");
    expect(hrefOf(container, /Endpoint/)).toBe("/assets/new?type=endpoint");
    expect(hrefOf(container, /^API/)).toBe("/assets/new?type=api");
    expect(hrefOf(container, /Identity System/)).toBe("/assets/new?type=identity_system");

    const all = hrefs(container);
    expect(all.filter((h) => h === "#" || h.trim() === "")).toEqual([]);
    expect(container.textContent).not.toMatch(/coming soon/i);
  });

  it("federated types open their authoritative screens, framed as a registry flow", async () => {
    on();
    eclOff();

    const { container } = await renderPage(NewAssetPage, { searchParams: sp({}) });

    // EAR-AD-1: the registry never duplicates the vendor / AI-system forms; it hands
    // off, and ?from=registry sends the breadcrumb back to Assets.
    expect(hrefOf(container, /^Vendor(Open screen)/)).toBe("/vendors/new?from=registry");
    expect(hrefOf(container, /^AI System(Open screen)/)).toBe("/ai-systems/new?from=registry");
  });

  it("with ECL OFF it never points at a dark page", async () => {
    on();
    eclOff();

    const { container } = await renderPage(NewAssetPage, { searchParams: sp({}) });

    // Applications / data stores / business processes are created on the Enterprise
    // Context surface — dark while its flag is off. Offering them anyway would be a
    // link into a 404, which is worse than not offering them.
    expect(hrefs(container).filter((h) => h.startsWith("/enterprise-context"))).toEqual([]);
    expect(hrefOf(container, /^Application(Open screen)/)).toBeNull();
  });

  it("with ECL ON the ECL-backed types appear, with entity_type AND asset_type preselected", async () => {
    on();
    eclOn();

    const { container } = await renderPage(NewAssetPage, { searchParams: sp({}) });

    const application = hrefOf(container, /^Application(Open screen)/);
    expect(application).toContain("/enterprise-context/entities/new");
    expect(application).toContain("entity_type=application");
    expect(application).toContain("asset_type=application");

    // "Database" is the canonical type; the ECL entity that backs it is data_store.
    const database = hrefOf(container, /^Database(Open screen)/);
    expect(database).toContain("entity_type=data_store");
    expect(database).toContain("asset_type=database");
  });

  it("choosing a native type renders that type's create FORM, with a way back", async () => {
    on();

    const { container } = await renderPage(NewAssetPage, {
      searchParams: sp({ type: "cloud_resource" }),
    });

    expect(screen.getByText(/New Cloud Resource/)).toBeInTheDocument();
    // Driven by DETAIL_TYPE_FIELDS → the form can only offer values the engine accepts.
    expect(screen.getByText(/Provider/)).toBeInTheDocument();
    expect(hrefOf(container, /Choose a different type/)).toBe("/assets/new");
  });

  it("a non-native type in ?type falls back to the method picker (never a broken form)", async () => {
    on();
    eclOff();

    // /assets/new?type=vendor must not try to render the native form for a federated
    // type — it shows the picker, from which the vendor screen is one click away.
    const { container } = await renderPage(NewAssetPage, { searchParams: sp({ type: "vendor" }) });

    expect(screen.getByText(/Add assets/)).toBeInTheDocument();
    expect(hrefOf(container, /^Vendor(Open screen)/)).toBe("/vendors/new?from=registry");
  });
});

// ── /assets/import — one import flow for every type ───────────────────

describe("/assets/import — the bulk-upload surface", () => {
  it("offers ONE import flow, with the real preview→commit affordances", async () => {
    on();
    eclOff();

    await renderPage(AssetImportPage, {});

    expect(screen.getByText(/Bulk upload assets/)).toBeInTheDocument();
    // Nothing is written until the customer commits — the promise must be on-screen.
    expect(screen.getByText(/nothing is written until you commit/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Preview/ })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("with ECL OFF it offers only the types whose import endpoint actually exists", async () => {
    on();
    eclOff();

    const { container } = await renderPage(AssetImportPage, {});

    const types = Array.from(container.querySelectorAll("option")).map((o) => o.textContent);
    // The four detail-backed types route to POST /api/assets/import, which is live.
    expect(types).toEqual(["Cloud Resource", "Endpoint", "API", "Identity System"]);
    // The ECL-backed types would hit a 404 endpoint while ECL is dark.
    expect(types).not.toContain("Vendor");
    expect(types).not.toContain("Application");
  });

  it("with ECL ON every one of the 10 canonical types is importable", async () => {
    on();
    eclOn();

    const { container } = await renderPage(AssetImportPage, {});

    const types = Array.from(container.querySelectorAll("option")).map((o) => o.textContent);
    expect(types).toHaveLength(10);
    expect(types).toEqual(
      expect.arrayContaining(["Cloud Resource", "Vendor", "AI System", "Application", "Database", "Other"])
    );
  });

  it("links back to the create surface it was reached from", async () => {
    on();

    const { container } = await renderPage(AssetImportPage, {});

    expect(hrefOf(container, /Add assets/)).toBe("/assets/new");
    expect(hrefs(container).filter((h) => h === "#" || h.trim() === "")).toEqual([]);
  });
});

// ── /assets/connect — the connector catalog ───────────────────────────

describe("/assets/connect — the connect surface", () => {
  it("lists the real connector catalog, each row routed to its config page", async () => {
    on();
    api.getConnectors.mockResolvedValue({
      ok: true,
      connectors: [
        anOrgConnector({ connector_id: "servicenow_cmdb", display_name: "ServiceNow CMDB" }),
        anOrgConnector({
          connector_id: "aws_config",
          display_name: "AWS Config",
          category: "cloud",
          configured: true,
          enabled: true,
          last_sync_at: "2026-06-01T00:00:00.000Z",
        }),
      ],
    });

    const { container } = await renderPage(ConnectAssetsPage, {});

    expect(hrefOf(container, /ServiceNow CMDB/)).toBe("/assets/connect/servicenow_cmdb");
    expect(hrefOf(container, /AWS Config/)).toBe("/assets/connect/aws_config");
    // Live state, not a static brochure: an unconfigured connector says so honestly.
    expect(screen.getByText(/an administrator adds credentials to connect/i)).toBeInTheDocument();
    expect(hrefs(container).filter((h) => h === "#" || h.trim() === "")).toEqual([]);
  });

  it("a failed catalog read is stated, not rendered as an empty catalog", async () => {
    on();
    api.getConnectors.mockResolvedValue({ ok: false, disabled: true, error: "not_found" });

    await renderPage(ConnectAssetsPage, {});

    expect(screen.queryByText(/No connector types are available/)).not.toBeInTheDocument();
    expect(screen.getByText(/Contact your administrator/i)).toBeInTheDocument();
  });

  it("links back to the create surface", async () => {
    on();

    const { container } = await renderPage(ConnectAssetsPage, {});

    expect(hrefOf(container, /Add an asset/)).toBe("/assets/new");
  });
});

// ── Flag OFF — the legacy (dark) experience, on all three surfaces ────

describe("the onboarding surfaces with SECURELOGIC_ASSET_REGISTRY_ENABLED off", () => {
  it("/assets/new shows the neutral not-available panel and NO create/import/connect offer", async () => {
    off();

    const { container } = await renderPage(NewAssetPage, { searchParams: sp({}) });

    expect(screen.getByText(/isn't available for your organization yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Create manually/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Bulk upload/)).not.toBeInTheDocument();
    expect(hrefs(container)).not.toContain("/assets/connect");
    expect(hrefs(container)).not.toContain("/assets/import");
  });

  it("/assets/new?type=… does not slip the create FORM past the dark flag", async () => {
    off();

    // The type-preselect branch runs before nothing: the flag check must dominate,
    // or a deep link becomes a hole through the dark launch.
    await renderPage(NewAssetPage, { searchParams: sp({ type: "cloud_resource" }) });

    expect(screen.getByText(/isn't available for your organization yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/New Cloud Resource/)).not.toBeInTheDocument();
  });

  it("/assets/import shows the panel and no importer", async () => {
    off();

    const { container } = await renderPage(AssetImportPage, {});

    expect(screen.getByText(/isn't available for your organization yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(container.querySelectorAll("option")).toHaveLength(0);
  });

  it("/assets/connect shows the panel and never reads the connector catalog", async () => {
    off();

    await renderPage(ConnectAssetsPage, {});

    expect(screen.getByText(/isn't available for your organization yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/ServiceNow CMDB/)).not.toBeInTheDocument();
    expect(api.getConnectors).not.toHaveBeenCalled();
  });
});

// ── Authorization on every onboarding surface ────────────────────────

describe("onboarding surfaces — authorization", () => {
  it("send a signed-out visitor to /login", async () => {
    on();
    signedOut();

    expect(await expectRedirect(NewAssetPage, { searchParams: sp({}) })).toBe("/login");
    expect(await expectRedirect(AssetImportPage, {})).toBe("/login");
    expect(await expectRedirect(ConnectAssetsPage, {})).toBe("/login");
  });

  it("send a Brief-tier (non-platform) user to /dashboard, before any flag branch", async () => {
    on();
    signedIn({ entitlementLevel: "professional" });

    expect(await expectRedirect(NewAssetPage, { searchParams: sp({}) })).toBe("/dashboard");
    expect(await expectRedirect(AssetImportPage, {})).toBe("/dashboard");
    expect(await expectRedirect(ConnectAssetsPage, {})).toBe("/dashboard");
    expect(api.getConnectors).not.toHaveBeenCalled();
  });
});
