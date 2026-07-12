/**
 * /dashboard — render contract.
 *
 * The dashboard is the platform's front door: twelve tiles, each printing an
 * enterprise-wide number and each promising a destination that reproduces it. The
 * defect class this file exists for (#638, #635, #637) is a tile whose href answers a
 * different question than the tile's number asks — a narrower status, a user-scoped
 * queue, a dropped filter. None of it is visible to an engine test, because the engine
 * never sees an href.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import {
  renderPage,
  expectRedirect,
  signedIn,
  signedOut,
  sp,
  hrefs,
  hrefOf,
} from "@/test/harness";
import {
  aDashboardSummary,
  aDomainScore,
  aFinding,
  aFindingsResponse,
  aFramework,
  aFrameworkReadiness,
  aMe,
  anAuthMe,
  aPostureSnapshot,
} from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  getAuthMe: vi.fn(),
  getIssues: vi.fn(),
  getLatestBrief: vi.fn(),
  getDashboardSummary: vi.fn(),
  getPostureHistory: vi.fn(),
  getFindings: vi.fn(),
  getFrameworks: vi.fn(),
  getFrameworkReadiness: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import DashboardPage from "../page";

const SUMMARY = aDashboardSummary({
  domains: [aDomainScore({ domain: "Third Party" }), aDomainScore({ domain: "Cyber" })],
});

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  // PostureDashboard hydrates its tile layout from /api/dashboard/preferences. A
  // non-ok response is the honest "no saved layout" path → the system default (all
  // twelve tiles), which is what a new customer sees.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

  api.getMe.mockResolvedValue(aMe({ entitlementLevel: "platform", organizationName: "Acme" }));
  api.getAuthMe.mockResolvedValue(anAuthMe());
  api.getIssues.mockResolvedValue(null);
  api.getLatestBrief.mockResolvedValue(null);
  api.getDashboardSummary.mockResolvedValue(SUMMARY);
  api.getPostureHistory.mockResolvedValue({ snapshots: [aPostureSnapshot()] });
  api.getFindings.mockResolvedValue(
    aFindingsResponse([aFinding({ id: "f-9", title: "Unencrypted backups", severity: "High" })])
  );
  api.getFrameworks.mockResolvedValue({ frameworks: [aFramework()] });
  api.getFrameworkReadiness.mockResolvedValue(aFrameworkReadiness());
});

async function renderDashboard() {
  return renderPage(DashboardPage, { searchParams: sp({}) });
}

describe("/dashboard — every tile's destination reproduces its number", () => {
  it("the findings tiles link to the ACTIVE list — never ?status=open", async () => {
    const { container } = await renderDashboard();

    // The tile prints the ACTIVE total (open + in_progress; the engine's
    // `findings.open` is a deprecated alias for it). `?status=open` would serve a
    // strictly smaller list than the number the customer clicked.
    expect(hrefOf(container, /View all open findings/)).toBe("/findings?active=true");

    const findingsLinks = hrefs(container).filter((h) => h.startsWith("/findings"));
    expect(findingsLinks.length).toBeGreaterThan(0);
    for (const href of findingsLinks) {
      expect(href).not.toContain("status=open");
    }
  });

  it("the severity donut segments carry BOTH severity and active", async () => {
    const { container } = await renderDashboard();

    for (const sev of ["Critical", "High", "Moderate", "Low"] as const) {
      expect(hrefs(container)).toContain(`/findings?severity=${sev}&active=true`);
    }
  });

  it("the domain posture bars link to that domain's ACTIVE findings", async () => {
    const { container } = await renderDashboard();

    expect(hrefs(container)).toContain("/findings?domain=Third%20Party&active=true");
    expect(hrefs(container)).toContain("/findings?domain=Cyber&active=true");
  });

  it("the Open Risks tile links to the active risk register", async () => {
    const { container } = await renderDashboard();

    // Scoped to the tile itself: the page carries several "View all" links, and the
    // Open Risks headline (6 open risks) is only reproduced by ?active=true.
    const card = screen.getByText("Open Risks").closest("div.rounded-xl") as HTMLElement;
    expect(hrefOf(card, /View all/)).toBe("/risks?active=true");
    expect(hrefs(container)).toContain("/risks?active=true");
  });

  it("the Actions tile links to the org-wide active queue that matches its ring", async () => {
    const { container } = await renderDashboard();

    expect(hrefOf(container, /View all open actions/)).toBe("/actions?active=true&view=team");
  });

  it("the Open Items Aging sections link to the same populations they age", async () => {
    const { container } = await renderDashboard();

    expect(hrefOf(container, /View findings/)).toBe("/findings?active=true");
    expect(hrefOf(container, /View actions/)).toBe("/actions?active=true&view=team");
  });
});

describe("/dashboard — an enterprise-wide tile never routes to My Work", () => {
  it("no link on the dashboard is scoped to the signed-in user", async () => {
    const { container } = await renderDashboard();

    // Every number on this page is org-wide. A `owner=me` / `view=mine` destination
    // answers an enterprise question with the caller's personal queue — the count
    // collapses on click and the customer cannot tell which number was the lie.
    for (const href of hrefs(container)) {
      expect(href).not.toContain("owner=me");
      expect(href).not.toContain("view=mine");
      expect(href).not.toContain("mine=true");
    }
  });

  it("every /actions link explicitly claims the org-wide scope", async () => {
    const { container } = await renderDashboard();

    const actionLinks = hrefs(container).filter((h) => h.startsWith("/actions"));
    expect(actionLinks.length).toBeGreaterThan(0);
    for (const href of actionLinks) {
      // `view=team` is what keeps the org-wide count honest once the Decision
      // Workspace is on — a bare /actions redirects to ?view=mine.
      expect(href).toContain("view=team");
    }
  });
});

describe("/dashboard — flag branches", () => {
  it("the tile destinations are identical whether the risk workspace is ON or OFF", async () => {
    // The dashboard reads no workspace flag itself, and that is the contract: the
    // links it emits must reconcile with their destinations in BOTH flag states, so
    // a flag flip can never produce a half-migrated dashboard.
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "false");
    const off = hrefs((await renderDashboard()).container);

    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "true");
    const on = hrefs((await renderDashboard()).container);

    expect(on).toEqual(off);
    expect(on).toContain("/findings?active=true");
    expect(on).toContain("/actions?active=true&view=team");
  });

  it("industry templates flag ON shows the banner to a brand-new user", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SECURELOGIC_INDUSTRY_TEMPLATES_ENABLED", "true");
    api.getAuthMe.mockResolvedValue(
      anAuthMe({ userCreatedAt: new Date().toISOString(), dismissedBannerKeys: [] })
    );

    const { container } = await renderDashboard();

    expect(screen.getByText(/load an industry template/)).toBeInTheDocument();
    expect(hrefs(container)).toContain("/templates");
  });

  it("industry templates flag OFF hides the banner entirely — no mixed state", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SECURELOGIC_INDUSTRY_TEMPLATES_ENABLED", "false");
    api.getAuthMe.mockResolvedValue(
      anAuthMe({ userCreatedAt: new Date().toISOString(), dismissedBannerKeys: [] })
    );

    const { container } = await renderDashboard();

    expect(screen.queryByText(/load an industry template/)).toBeNull();
    expect(hrefs(container)).not.toContain("/templates");
  });
});

describe("/dashboard — honest states", () => {
  it("a FAILED summary load renders an explicit error, not an empty posture panel", async () => {
    api.getDashboardSummary.mockResolvedValue(null);

    const { container } = await renderDashboard();

    // A zeros summary is a real "you're clear"; a null summary is a load failure.
    // Rendering nothing (or zeros) for the failure tells the customer their posture
    // is clean when the truth is that it is unknown.
    expect(screen.getByText(/couldn't load your posture data/i)).toBeInTheDocument();
    expect(screen.queryByText("Open Risks")).toBeNull();
    expect(hrefs(container)).not.toContain("/findings?active=true");
  });

  it("a zeros summary renders the real panel — an empty org is not an error", async () => {
    api.getDashboardSummary.mockResolvedValue(
      aDashboardSummary({
        domains: [],
        findings: { open: 0, by_severity: { Critical: 0, High: 0, Moderate: 0, Low: 0 } },
        actions: { open: 0, in_progress: 0, blocked: 0, active: 0, overdue: 0 },
      })
    );

    const { container } = await renderDashboard();

    expect(screen.queryByText(/couldn't load your posture data/i)).toBeNull();
    expect(hrefs(container)).toContain("/findings?active=true");
  });
});

describe("/dashboard — authorization", () => {
  it("sends a signed-out visitor to /login", async () => {
    signedOut();
    expect(await expectRedirect(DashboardPage, { searchParams: sp({}) })).toBe("/login");
  });

  it("an unentitled caller gets the SAMPLE preview and none of the real org data", async () => {
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "starter" }));

    const { container } = await renderDashboard();

    // The real behavior: no redirect — a blurred sample dashboard plus an upgrade CTA.
    // What matters for isolation is that no real posture number and no platform
    // destination leaks into it.
    expect(screen.getByText(/SAMPLE PREVIEW/)).toBeInTheDocument();
    expect(screen.getByText(/Upgrade to Platform Professional/)).toBeInTheDocument();

    expect(api.getDashboardSummary).toHaveBeenCalled(); // fetched, but must not be shown
    expect(screen.queryByText("Open Risks")).toBeNull();
    expect(hrefs(container).filter((h) => h.startsWith("/findings"))).toEqual([]);
    expect(hrefs(container).filter((h) => h.startsWith("/actions"))).toEqual([]);
    expect(hrefs(container).filter((h) => h.startsWith("/risks"))).toEqual([]);
  });

  it("an unentitled caller is never asked for platform-only data", async () => {
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "starter" }));

    await renderDashboard();

    expect(api.getFindings).not.toHaveBeenCalled();
    expect(api.getFrameworks).not.toHaveBeenCalled();
  });
});
