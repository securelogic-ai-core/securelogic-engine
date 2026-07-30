/**
 * /dashboard — The Briefing (Briefing Initiative B1) render contract.
 *
 * The flag matrix this file pins:
 *   - flag OFF → the legacy dashboard, byte-for-byte (no Briefing markers);
 *   - flag ON + platform JWT → The Briefing: personal work first, every module
 *     scope-chipped, org-wide numbers never under personal labels;
 *   - flag ON + non-platform tier → the legacy brief-centric page + SAMPLE
 *     preview, zero platform UI (THE entitlement-branch test: the summary data
 *     sits in props for every tier — only the branch prevents the leak);
 *   - flag ON + API-key session → personal zone ABSENT (never zeroed).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderPage, signedIn, apiKeyOnly, sp, hrefs } from "@/test/harness";
import {
  aDashboardSummary,
  aDomainScore,
  aFinding,
  aFindingsResponse,
  aFindingsSummary,
  aFramework,
  aFrameworkReadiness,
  aMe,
  anActionsSummary,
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
  getFindingsSummary: vi.fn(),
  getFrameworks: vi.fn(),
  getFrameworkReadiness: vi.fn(),
  getActionsSummary: vi.fn(),
  // B2 — saved layout + legacy-preference projection inputs.
  getBriefingLayout: vi.fn(),
  getDashboardPreferences: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import DashboardPage from "../page";

const SUMMARY = aDashboardSummary({
  domains: [aDomainScore({ domain: "Cyber" })],
  findings: {
    open: 8,
    by_severity: { Critical: 2, High: 3, Moderate: 2, Low: 1 },
    pending_independent_review: 5,
  },
  actions: { open: 4, in_progress: 2, blocked: 1, active: 7, overdue: 2 },
});

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

  api.getMe.mockResolvedValue(aMe({ entitlementLevel: "platform", organizationName: "Acme" }));
  api.getAuthMe.mockResolvedValue(anAuthMe());
  api.getIssues.mockResolvedValue(null);
  api.getLatestBrief.mockResolvedValue(null);
  api.getDashboardSummary.mockResolvedValue(SUMMARY);
  api.getPostureHistory.mockResolvedValue({ snapshots: [aPostureSnapshot()] });
  api.getFindings.mockResolvedValue(
    aFindingsResponse([aFinding({ id: "f-1", title: "Unencrypted backups", severity: "High" })])
  );
  api.getFindingsSummary.mockResolvedValue({
    summary: aFindingsSummary({
      my_work_open: 3,
      my_pending_reviews_open: 1,
    }),
  });
  api.getFrameworks.mockResolvedValue({ frameworks: [aFramework()] });
  api.getFrameworkReadiness.mockResolvedValue(aFrameworkReadiness());
  api.getActionsSummary.mockResolvedValue(
    anActionsSummary({ my_open_count: 2, my_overdue_count: 1 })
  );
  // B2 defaults: no saved layout, no legacy customization → role default.
  api.getBriefingLayout.mockResolvedValue({ layout: null, updated_at: null });
  api.getDashboardPreferences.mockResolvedValue({ layout: [], source: "system_default" });
});

async function renderDashboard() {
  return renderPage(DashboardPage, { searchParams: sp({}) });
}

describe("flag OFF — the legacy dashboard is untouched", () => {
  it("renders zero Briefing markers and never calls the actions summary", async () => {
    vi.stubEnv("SECURELOGIC_DASHBOARD_BRIEFING_ENABLED", "false");

    const { container } = await renderDashboard();

    expect(container.querySelector("[data-briefing]")).toBeNull();
    expect(screen.queryByText("The Briefing")).toBeNull();
    // Legacy composition present.
    expect(screen.getByText("Latest Brief")).toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
    // Flag-off network behavior unchanged: no Briefing-only fetch.
    expect(api.getActionsSummary).not.toHaveBeenCalled();
  });
});

describe("flag ON + platform JWT — The Briefing", () => {
  beforeEach(() => {
    vi.stubEnv("SECURELOGIC_DASHBOARD_BRIEFING_ENABLED", "true");
    vi.stubEnv("SECURELOGIC_INDEPENDENT_REVIEW_ENABLED", "true");
  });

  it("renders the three zones, personal work FIRST", async () => {
    const { container } = await renderDashboard();

    expect(container.querySelector("[data-briefing]")).not.toBeNull();
    expect(screen.getByText("The Briefing")).toBeInTheDocument();

    const zones = Array.from(
      container.querySelectorAll("[data-briefing-zone]")
    ).map((el) => el.getAttribute("data-briefing-zone"));
    expect(zones).toEqual(["your_work", "organization", "intelligence"]);
  });

  it("every stat module carries an explicit scope chip — You vs Organization", async () => {
    const { container } = await renderDashboard();

    const myWork = container.querySelector('[data-briefing-module="my_work"]') as HTMLElement;
    expect(within(myWork).getByText("You")).toBeInTheDocument();

    const needsAttention = container.querySelector(
      '[data-briefing-module="needs_attention"]'
    ) as HTMLElement;
    expect(within(needsAttention).getByText("Organization")).toBeInTheDocument();
  });

  it("My Work leads with the caller's OWN counts and links the owner-scoped views", async () => {
    const { container } = await renderDashboard();

    const myWork = container.querySelector('[data-briefing-module="my_work"]') as HTMLElement;
    expect(within(myWork).getByText("3")).toBeInTheDocument(); // my_work_open
    expect(within(myWork).getByText("2")).toBeInTheDocument(); // my_open_count
    expect(within(myWork).getByText(/1 overdue/)).toBeInTheDocument();
    expect(hrefs(myWork)).toContain("/findings?bucket=my_work");
    expect(hrefs(myWork)).toContain("/actions?view=mine");
  });

  it("personal and org review counts render as SEPARATE, scope-chipped modules", async () => {
    const { container } = await renderDashboard();

    // Personal: My Pending Reviews (mine = 1) in Your Work, org total as labeled context.
    const mine = container.querySelector(
      '[data-briefing-module="my_pending_reviews"]'
    ) as HTMLElement;
    expect(within(mine).getByText("1")).toBeInTheDocument();
    expect(within(mine).getByText(/5 organization-wide ready to close/)).toBeInTheDocument();
    expect(within(mine).getByText("You")).toBeInTheDocument();

    // Org: Ready to Close (5) in the organization zone, chipped Organization.
    const org = container.querySelector('[data-briefing-module="ready_to_close"]') as HTMLElement;
    expect(within(org).getByText("5")).toBeInTheDocument();
    expect(within(org).getByText("Organization")).toBeInTheDocument();
  });

  it("org-wide action links keep the view=team scope discipline", async () => {
    const { container } = await renderDashboard();
    const mod = container.querySelector(
      '[data-briefing-module="overdue_actions"]'
    ) as HTMLElement;
    for (const href of hrefs(mod)) {
      expect(href).toContain("view=team");
    }
  });

  it("does not reproduce the analytical dashboard — it links to /posture instead", async () => {
    const { container } = await renderDashboard();

    // Legacy 12-tile grid markers absent…
    expect(screen.queryByText("Open Risks")).toBeNull();
    expect(screen.queryByText(/Executive Report/)).toBeNull();
    // …and the dashboards row points at their real homes.
    const row = container.querySelector("[data-briefing-dashboards]") as HTMLElement;
    expect(hrefs(row)).toEqual(["/posture", "/frameworks"]);
  });

  it("a FAILED summary load renders an explicit org-zone error — never zeros", async () => {
    api.getDashboardSummary.mockResolvedValue(null);

    const { container } = await renderDashboard();

    expect(screen.getByText(/couldn't load your organization's data/i)).toBeInTheDocument();
    expect(container.querySelector('[data-briefing-module="needs_attention"]')).toBeNull();
  });

  it("independent-review flag OFF resolves My Pending Reviews away entirely", async () => {
    vi.stubEnv("SECURELOGIC_INDEPENDENT_REVIEW_ENABLED", "false");

    const { container } = await renderDashboard();

    expect(container.querySelector('[data-briefing-module="my_pending_reviews"]')).toBeNull();
    expect(screen.queryByText("My Pending Reviews")).toBeNull();
  });
});

describe("flag ON + non-platform tier — the entitlement branch (mandatory)", () => {
  it("a Brief-tier session gets the legacy page + SAMPLE preview, zero platform UI", async () => {
    vi.stubEnv("SECURELOGIC_DASHBOARD_BRIEFING_ENABLED", "true");
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "professional" }));

    const { container } = await renderDashboard();

    // The Briefing must NOT render — even though getDashboardSummary was fetched
    // and its data sits in the page's scope for every tier.
    expect(api.getDashboardSummary).toHaveBeenCalled();
    expect(container.querySelector("[data-briefing]")).toBeNull();
    expect(screen.getByText(/SAMPLE PREVIEW/)).toBeInTheDocument();

    // No real platform destination leaks.
    expect(hrefs(container).filter((h) => h.startsWith("/findings"))).toEqual([]);
    expect(hrefs(container).filter((h) => h.startsWith("/actions"))).toEqual([]);
    // No Briefing-only fetch for a non-platform tier either.
    expect(api.getActionsSummary).not.toHaveBeenCalled();
  });
});

describe("flag ON + API-key session — honest omission", () => {
  it("personal zone is ABSENT (never zeroed); organization zone still renders", async () => {
    vi.stubEnv("SECURELOGIC_DASHBOARD_BRIEFING_ENABLED", "true");
    vi.stubEnv("SECURELOGIC_INDEPENDENT_REVIEW_ENABLED", "true");
    apiKeyOnly();
    // An API-key caller gets no session-scoped fields from the engine either.
    api.getFindingsSummary.mockResolvedValue({ summary: aFindingsSummary() });
    api.getActionsSummary.mockResolvedValue(anActionsSummary({ my_open_count: 0, my_overdue_count: 0 }));

    const { container } = await renderDashboard();

    expect(container.querySelector("[data-briefing]")).not.toBeNull();
    expect(container.querySelector('[data-briefing-zone="your_work"]')).toBeNull();
    expect(container.querySelector('[data-briefing-module="my_work"]')).toBeNull();
    expect(screen.queryByText("My Pending Reviews")).toBeNull();
    // Org modules unaffected.
    expect(container.querySelector('[data-briefing-module="needs_attention"]')).not.toBeNull();
  });
});

// ── B2: role-aware defaults & personalization ────────────────────────────────

function envelope(ids: string[]) {
  return {
    version: 1,
    modules: ids.map((moduleId) => ({ moduleId, instanceKey: moduleId, config: {} })),
  };
}

function moduleOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-briefing-module]")).map(
    (el) => el.getAttribute("data-briefing-module") ?? ""
  );
}

describe("flag ON + B2 — saved layouts", () => {
  it("renders modules in the SAVED order, not the canonical order", async () => {
    vi.stubEnv("SECURELOGIC_DASHBOARD_BRIEFING_ENABLED", "true");
    api.getBriefingLayout.mockResolvedValue({
      layout: envelope(["posture_score", "needs_attention", "my_work", "latest_brief"]),
      updated_at: "2026-07-21T00:00:00Z",
    });

    const { container } = await renderDashboard();

    expect(moduleOrder(container)).toEqual([
      "posture_score",
      "needs_attention",
      "my_work",
      "latest_brief",
    ]);
    // A reordered layout keeps zone titles over contiguous runs — the personal
    // module mid-layout still gets its own "Your Work" section.
    expect(container.querySelector('[data-briefing-zone="your_work"]')).not.toBeNull();
    // No projection fetch when a saved layout exists.
    expect(api.getDashboardPreferences).not.toHaveBeenCalled();
    // No disclosure banner for a saved layout.
    expect(container.querySelector("[data-briefing-migration-disclosure]")).toBeNull();
  });

  it("a saved layout HIDES absent modules and can never grant an ineligible one", async () => {
    vi.stubEnv("SECURELOGIC_DASHBOARD_BRIEFING_ENABLED", "true");
    vi.stubEnv("SECURELOGIC_INDEPENDENT_REVIEW_ENABLED", "false");
    api.getBriefingLayout.mockResolvedValue({
      // my_pending_reviews is stored (C4: writes accept it) but the flag is off
      // — it must NOT render. overdue_actions is absent → hidden.
      layout: envelope(["my_work", "my_pending_reviews", "needs_attention"]),
      updated_at: "2026-07-21T00:00:00Z",
    });

    const { container } = await renderDashboard();

    expect(moduleOrder(container)).toEqual(["my_work", "needs_attention"]);
    expect(container.querySelector('[data-briefing-module="overdue_actions"]')).toBeNull();
    expect(screen.queryByText("My Pending Reviews")).toBeNull();
  });

  it("a malformed stored envelope falls back to the unsaved state (role default)", async () => {
    vi.stubEnv("SECURELOGIC_DASHBOARD_BRIEFING_ENABLED", "true");
    api.getBriefingLayout.mockResolvedValue({ layout: { version: 99 }, updated_at: null });

    const { container } = await renderDashboard();

    // member (unknown role) → canonical composition, same as B1.
    expect(container.querySelector('[data-briefing-module="my_work"]')).not.toBeNull();
    expect(container.querySelector('[data-briefing-module="posture_score"]')).not.toBeNull();
  });
});

describe("flag ON + B2 — role-aware defaults", () => {
  it("viewer default omits workflow modules and withholds the customize surface", async () => {
    vi.stubEnv("SECURELOGIC_DASHBOARD_BRIEFING_ENABLED", "true");
    signedIn({ userRole: "viewer" });

    const { container } = await renderDashboard();

    expect(container.querySelector('[data-briefing-module="my_work"]')).toBeNull();
    expect(container.querySelector('[data-briefing-module="overdue_actions"]')).toBeNull();
    expect(container.querySelector('[data-briefing-module="posture_score"]')).not.toBeNull();
    // Viewers cannot persist a layout — no customize affordance at all.
    expect(container.querySelector("[data-briefing-customize-open]")).toBeNull();
    expect(container.querySelector("[data-briefing-customize]")).toBeNull();
  });

  it("analyst default triages: recent findings before the posture score; customize offered", async () => {
    vi.stubEnv("SECURELOGIC_DASHBOARD_BRIEFING_ENABLED", "true");
    signedIn({ userRole: "analyst" });

    const { container } = await renderDashboard();

    const order = moduleOrder(container);
    expect(order.indexOf("recent_findings")).toBeLessThan(order.indexOf("posture_score"));
    expect(container.querySelector("[data-briefing-customize-open]")).not.toBeNull();
  });
});

describe("flag ON + B2 — legacy-preference projection (the migration path)", () => {
  it("carries superseded tile visibility, discloses dropped tiles by LABEL, and stays unsaved", async () => {
    vi.stubEnv("SECURELOGIC_DASHBOARD_BRIEFING_ENABLED", "true");
    api.getBriefingLayout.mockResolvedValue({ layout: null, updated_at: null });
    api.getDashboardPreferences.mockResolvedValue({
      source: "personal",
      layout: [
        { id: "posture_score", visible: true, order: 0 },
        { id: "findings_donut", visible: false, order: 1 }, // hidden → hides needs_attention
        { id: "actions_ring", visible: true, order: 2 },
        { id: "risk_heatmap", visible: true, order: 3 }, // no counterpart → disclosed
      ],
    });

    const { container } = await renderDashboard();

    // The hidden superseded tile hides its module.
    expect(container.querySelector('[data-briefing-module="needs_attention"]')).toBeNull();
    expect(container.querySelector('[data-briefing-module="overdue_actions"]')).not.toBeNull();
    // The disclosure banner names the dropped tile by its display label.
    const banner = container.querySelector("[data-briefing-migration-disclosure]");
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("Risk Heatmap");
    // D1 parity copy: the banner may now truthfully claim every analytical
    // tile lives on the Posture dashboard, and must link there.
    expect(banner?.textContent).toContain("Every analytical tile now lives");
    const postureLink = Array.from(banner?.querySelectorAll("a") ?? []).find(
      (a) => a.getAttribute("href") === "/posture"
    );
    expect(postureLink).not.toBeUndefined();
  });

  it("system_default preferences mean NO projection and NO banner", async () => {
    vi.stubEnv("SECURELOGIC_DASHBOARD_BRIEFING_ENABLED", "true");

    const { container } = await renderDashboard();

    expect(container.querySelector("[data-briefing-migration-disclosure]")).toBeNull();
    expect(container.querySelector('[data-briefing-module="needs_attention"]')).not.toBeNull();
  });
});

describe("flag ON — fresh-org truthfulness (EG2 slice 2)", () => {
  beforeEach(() => {
    vi.stubEnv("SECURELOGIC_DASHBOARD_BRIEFING_ENABLED", "true");
  });

  /** An org with NO platform data at all: no snapshot, findings, actions,
   *  domains, risks, or frameworks. hasPlatformData (D-2) must be false. */
  function freshOrg() {
    api.getDashboardSummary.mockResolvedValue(
      aDashboardSummary({
        posture: null,
        domains: [],
        findings: {
          open: 0,
          by_severity: { Critical: 0, High: 0, Moderate: 0, Low: 0 },
        },
        actions: { open: 0, in_progress: 0, blocked: 0, active: 0, overdue: 0 },
        risks_summary: {
          open: 0,
          by_risk_rating: {},
          by_residual_rating: {},
          by_residual_likelihood_impact: [],
        },
      } as never)
    );
    api.getPostureHistory.mockResolvedValue({ snapshots: [] });
    api.getFindings.mockResolvedValue(aFindingsResponse([]));
    api.getFrameworks.mockResolvedValue({ frameworks: [] });
    api.getFindingsSummary.mockResolvedValue({
      summary: aFindingsSummary({ my_work_open: 0, active_total: 0, closed_count: 0 }),
    });
    api.getActionsSummary.mockResolvedValue(
      anActionsSummary({ my_open_count: 0, my_overdue_count: 0 })
    );
  }

  it("an unmeasured org is never told it is clear — zero-count modules read as 'nothing yet'", async () => {
    freshOrg();

    await renderDashboard();

    // The trust rule: green reassurance must not render on unassessed data.
    expect(screen.queryByText(/You're clear/)).toBeNull();
    expect(screen.queryByText(/No Critical or High active findings/)).toBeNull();
    // Instead: honest not-yet-measured states with a route into setup.
    expect(screen.getByText(/Nothing assigned to you yet/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing assessed yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Start setup/ })).toHaveAttribute(
      "href",
      "/getting-started"
    );
  });

  it("an org WITH data and zero Critical/High still gets the earned all-clear", async () => {
    // Real data present (default SUMMARY has domains + snapshot) but no
    // critical/high and nothing assigned to the caller.
    api.getDashboardSummary.mockResolvedValue(
      aDashboardSummary({
        findings: {
          open: 1,
          by_severity: { Critical: 0, High: 0, Moderate: 1, Low: 0 },
        },
      } as never)
    );
    api.getFindingsSummary.mockResolvedValue({
      summary: aFindingsSummary({ my_work_open: 0 }),
    });
    api.getActionsSummary.mockResolvedValue(
      anActionsSummary({ my_open_count: 0, my_overdue_count: 0 })
    );

    await renderDashboard();

    expect(screen.getByText(/No Critical or High active findings/)).toBeInTheDocument();
    expect(screen.getByText(/You're clear/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing assessed yet/)).toBeNull();
  });
});
