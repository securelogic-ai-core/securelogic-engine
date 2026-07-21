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
