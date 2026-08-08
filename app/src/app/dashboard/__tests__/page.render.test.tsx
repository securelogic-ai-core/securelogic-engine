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
import { screen, within } from "@testing-library/react";
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
  aFindingsSummary,
  aFramework,
  aFrameworkReadiness,
  aMe,
  anAuthMe,
  aNewsletterIssue,
  anIssuesResponse,
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
  api.getLatestBrief.mockResolvedValue({ state: "none" });
  api.getDashboardSummary.mockResolvedValue(SUMMARY);
  api.getPostureHistory.mockResolvedValue({ snapshots: [aPostureSnapshot()] });
  api.getFindings.mockResolvedValue(
    aFindingsResponse([aFinding({ id: "f-9", title: "Unencrypted backups", severity: "High" })])
  );
  // Default: findings summary unavailable → the review tile can only ever be the
  // org-wide variant (an unknown personal count must never be treated as one).
  api.getFindingsSummary.mockResolvedValue(null);
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
    expect(hrefOf(container, /View all active findings/)).toBe("/findings?active=true");

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
    // The dashboard's TILES read no workspace flag, and that is the contract: the
    // links they emit must reconcile with their destinations in BOTH flag states, so
    // a flag flip can never produce a half-migrated dashboard.
    //
    // NARROWED (EG3 Wave 1): the orientation panel (WhatsNewPanel) is the one
    // deliberately flag-conditional element on this page — it exists ONLY in the ON
    // state because it explains the navigation change that the ON state IS. It is
    // therefore excluded here rather than weakening the tile contract. Its links
    // cannot half-migrate: they render only when the flag is on, and every one is
    // pinned to a Wave-1-reachable destination in whatsNew.test.ts.
    const tileHrefs = (container: HTMLElement) => {
      container.querySelector('[aria-labelledby="whats-new-heading"]')?.remove();
      return hrefs(container);
    };

    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "false");
    const off = tileHrefs((await renderDashboard()).container);

    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "true");
    const on = tileHrefs((await renderDashboard()).container);

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

// ── Walkthrough remediation (D-1 / D-2 / D-4 / D-5) ─────────────────────────

describe("dashboard — enterprise vs newsletter truthfulness (walkthrough)", () => {
  const EMPTY_SUMMARY = aDashboardSummary({
    posture: { overall_score: null, overall_severity: null, snapshot_date: null },
    domains: [],
    findings: { open: 0, by_severity: { Critical: 0, High: 0, Moderate: 0, Low: 0 } },
    actions: { open: 0, in_progress: 0, overdue: 0 },
    risks_summary: { open: 0, by_risk_rating: { Critical: 0, High: 0, Moderate: 0, Low: 0 } },
  });

  it("D-1/D-4: a platform tenant is addressed as a platform, not a Brief Lite subscriber", async () => {
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "platform", organizationName: "Acme" }));
    await renderPage(DashboardPage, { searchParams: sp({}) });
    expect(screen.getByText(/access to the SecureLogic platform/i)).toBeInTheDocument();
    expect(screen.queryByText(/Intelligence Brief Lite/i)).toBeNull();
    // No consumer upsell on an enterprise tenant.
    expect(screen.queryByText(/Upgrade your plan/i)).toBeNull();
  });

  it("a platform tenant's upgrade-success banner names the plan, never 'brief access'", async () => {
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "platform", organizationName: "Acme" }));
    await renderPage(DashboardPage, { searchParams: sp({ upgraded: "true" }) });
    // The tenant just bought the platform — "Full brief access is now enabled"
    // read as if they'd purchased the newsletter.
    expect(screen.getByText(/Platform Professional is now active/i)).toBeInTheDocument();
    expect(screen.queryByText(/Full brief access is now enabled/i)).toBeNull();
  });

  it("D-2: the 'complete setup to start tracking posture' banner is hidden when the tenant has data", async () => {
    // Default beforeEach seeds a posture snapshot + domains → the org is already tracking.
    await renderPage(DashboardPage, { searchParams: sp({}) });
    expect(screen.queryByText(/Complete your security program setup to start tracking your posture/i)).toBeNull();
  });

  it("D-2: the setup banner still shows for a genuinely empty platform tenant", async () => {
    api.getDashboardSummary.mockResolvedValue(EMPTY_SUMMARY);
    api.getPostureHistory.mockResolvedValue({ snapshots: [] });
    api.getFindings.mockResolvedValue(aFindingsResponse([]));
    api.getFrameworks.mockResolvedValue({ frameworks: [] });
    await renderPage(DashboardPage, { searchParams: sp({}) });
    expect(screen.getByText(/Complete your security program setup to start tracking your posture/i)).toBeInTheDocument();
  });

  it("D-5: Framework Readiness carries copy distinguishing it from Compliance Coverage", async () => {
    await renderPage(DashboardPage, { searchParams: sp({}) });
    expect(screen.getByText(/How close each activated framework is to being audit-ready/i)).toBeInTheDocument();
  });

  it("item 7: the Readiness widget renders the engine's coverage caption and a segmented bar", async () => {
    // aFrameworkReadiness: 11 satisfied / 4 partial / 5 unmapped of 20 → the
    // widget must show the caption verbatim (satisfied-only score explained)
    // and render partial work as a hatched segment distinct from the solid one.
    const { container } = await renderPage(DashboardPage, { searchParams: sp({}) });
    expect(container.textContent).toContain("11 fully satisfied · 4 partial · 5 unmapped");
    expect(container.querySelector('[data-coverage-segment="satisfied"]')).not.toBeNull();
    const partialSeg = container.querySelector('[data-coverage-segment="partial"]') as HTMLElement;
    expect(partialSeg).not.toBeNull();
    expect(partialSeg.style.background).toContain("repeating-linear-gradient");
  });
});

// ── Staging validation defects (2026-07-17): Latest Brief entitlement + staleness ──

describe("dashboard — Latest Brief fallback: entitlement + staleness", () => {
  const DAY_MS = 86_400_000;
  const staleDate = new Date(Date.now() - 60 * DAY_MS).toISOString(); // ~8½ weeks ago
  const freshDate = new Date(Date.now() - 1 * DAY_MS).toISOString();

  it("a platform tenant with a LOCKED issue sees zero Free/Brief Pro upsell strings", async () => {
    // The staging defect verbatim: entitlement 'platform', no intelligence
    // brief, engine returned the newsletter issue locked.
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "platform", organizationName: "Acme" }));
    api.getLatestBrief.mockResolvedValue({ state: "none" });
    api.getIssues.mockResolvedValue(
      anIssuesResponse([
        aNewsletterIssue({ locked: true, audience_tier: "premium", publish_date: staleDate, created_at: staleDate }),
      ])
    );

    await renderDashboard();

    expect(screen.queryByText(/Free preview/i)).toBeNull();
    expect(screen.queryByText(/Your free brief includes/i)).toBeNull();
    expect(screen.queryByText(/Available to Brief Pro and Team subscribers/i)).toBeNull();
    expect(screen.queryByText(/Upgrade to Brief Pro/i)).toBeNull();
    // The neutral unavailable state renders in its place.
    expect(screen.getByText(/isn't available right now/i)).toBeInTheDocument();
    expect(screen.getByText(/no upgrade is needed/i)).toBeInTheDocument();
  });

  it("a stale latest issue carries the amber age warning (platform tenant, unlocked)", async () => {
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "platform", organizationName: "Acme" }));
    api.getLatestBrief.mockResolvedValue({ state: "none" });
    api.getIssues.mockResolvedValue(
      anIssuesResponse([
        aNewsletterIssue({ locked: false, publish_date: staleDate, created_at: staleDate }),
      ])
    );

    await renderDashboard();

    expect(screen.getByText(/This brief is 8 weeks old/)).toBeInTheDocument();
    expect(screen.getByText(/briefs are published weekly/i)).toBeInTheDocument();
    expect(screen.getByText(/Last published/)).toBeInTheDocument();
  });

  it("a current latest issue shows NO staleness warning", async () => {
    api.getLatestBrief.mockResolvedValue({ state: "none" });
    api.getIssues.mockResolvedValue(
      anIssuesResponse([
        aNewsletterIssue({ locked: false, publish_date: freshDate, created_at: freshDate }),
      ])
    );

    await renderDashboard();

    expect(screen.queryByText(/weeks old|days old/)).toBeNull();
  });

  it("a free-tier tenant keeps the locked teaser + Brief Pro upsell", async () => {
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "starter" }));
    api.getLatestBrief.mockResolvedValue({ state: "none" });
    api.getIssues.mockResolvedValue(
      anIssuesResponse([
        aNewsletterIssue({ locked: true, audience_tier: "standard", publish_date: freshDate, created_at: freshDate }),
      ])
    );

    await renderDashboard();

    expect(screen.getByText(/Free preview/)).toBeInTheDocument();
    expect(screen.getByText(/Upgrade to Brief Pro — \$49\/mo/)).toBeInTheDocument();
    expect(screen.queryByText(/isn't available right now/i)).toBeNull();
  });
});

describe("dashboard — no raw source_type enums reach the customer (walkthrough item 6)", () => {
  it("a signal-sourced finding with no domain renders a customer label, not the enum", async () => {
    api.getFindings.mockResolvedValue(
      aFindingsResponse([
        aFinding({ id: "f-sig", title: "Vendor security advisory: Acme", source_type: "cyber_signal", domain: null }),
        aFinding({ id: "f-evt", title: "CVE-2026-90001 under exploitation", source_type: "intelligence_event", domain: null }),
      ]),
    );
    const { container } = await renderPage(DashboardPage, { searchParams: sp({}) });
    expect(container.textContent).not.toContain("cyber_signal");
    expect(container.textContent).not.toContain("intelligence_event");
    expect(screen.getByText("Signal")).toBeInTheDocument();
    expect(screen.getByText("Intelligence")).toBeInTheDocument();
  });
});

// ── Governance-review tile: count SCOPE and labels (count-scope fix, 2026-07-20) ──
// One predicate, two scopes. The defect: the tile showed the ORG-WIDE count (5)
// under the personal queue's label, so a reviewer with 1 assigned review read
// "5 pending" as theirs. These pin what the customer SEES for each scope.
describe("dashboard — governance-review tile scope", () => {
  const SUMMARY_WITH_REVIEWS = aDashboardSummary({
    domains: [aDomainScore({ domain: "Third Party" }), aDomainScore({ domain: "Cyber" })],
    findings: {
      open: 8,
      by_severity: { Critical: 2, High: 3, Moderate: 2, Low: 1 },
      avg_age_days: 12,
      max_age_days: 40,
      older_than_30: 1,
      older_than_7: 3,
      pending_independent_review: 5,
    },
  });

  it("a reviewer with assigned reviews sees THEIR count first, org-wide as labeled context", async () => {
    vi.stubEnv("SECURELOGIC_INDEPENDENT_REVIEW_ENABLED", "true");
    api.getDashboardSummary.mockResolvedValue(SUMMARY_WITH_REVIEWS);
    api.getFindingsSummary.mockResolvedValue({
      summary: aFindingsSummary({ my_pending_reviews_open: 1 }),
    });

    const { container } = await renderDashboard();

    // Scope to the tile itself — the dashboard prints many numbers.
    const tile = screen.getByText("My Pending Reviews").closest("a") as HTMLElement;
    expect(tile).toBeTruthy();
    expect(within(tile).getByText("1")).toBeInTheDocument();
    // The org total is visible but explicitly organization-wide — never conflatable
    // with the personal number.
    expect(within(tile).getByText(/5 organization-wide ready to close/)).toBeInTheDocument();
    // The headline links to the REVIEWER'S queue, which reproduces the number 1.
    expect(hrefOf(container, /My Pending Reviews/)).toBe(
      "/findings?bucket=pending_independent_review"
    );
    // The org-wide label must not render as the headline.
    expect(screen.queryByText("Pending Independent Review")).toBeNull();
  });

  it("no assigned reviews → the org-wide tile, explicitly labeled organization-wide", async () => {
    vi.stubEnv("SECURELOGIC_INDEPENDENT_REVIEW_ENABLED", "true");
    api.getDashboardSummary.mockResolvedValue(SUMMARY_WITH_REVIEWS);
    api.getFindingsSummary.mockResolvedValue({
      summary: aFindingsSummary({ my_pending_reviews_open: 0 }),
    });

    const { container } = await renderDashboard();

    const tile = screen.getByText("Ready to Close").closest("a") as HTMLElement;
    expect(tile).toBeTruthy();
    expect(within(tile).getByText(/Organization-wide/)).toBeInTheDocument();
    expect(within(tile).getByText("5")).toBeInTheDocument();
    expect(hrefOf(container, /Ready to Close/)).toBe("/findings?bucket=ready_to_close");
    expect(screen.queryByText("My Pending Reviews")).toBeNull();
  });

  it("flag OFF → never the personal variant (its queue does not exist), even with a personal count", async () => {
    // No env stub — SECURELOGIC_INDEPENDENT_REVIEW_ENABLED unset.
    api.getDashboardSummary.mockResolvedValue(SUMMARY_WITH_REVIEWS);
    api.getFindingsSummary.mockResolvedValue({
      summary: aFindingsSummary({ my_pending_reviews_open: 1 }),
    });

    const { container } = await renderDashboard();

    expect(screen.queryByText("My Pending Reviews")).toBeNull();
    expect(screen.getByText("Ready to Close")).toBeInTheDocument();
    expect(hrefOf(container, /Ready to Close/)).toBe("/findings?bucket=ready_to_close");
  });

  it("unknown personal count (summary fetch failed) falls back to the org-wide tile — never a fake personal zero", async () => {
    vi.stubEnv("SECURELOGIC_INDEPENDENT_REVIEW_ENABLED", "true");
    api.getDashboardSummary.mockResolvedValue(SUMMARY_WITH_REVIEWS);
    api.getFindingsSummary.mockResolvedValue(null);

    await renderDashboard();

    expect(screen.queryByText("My Pending Reviews")).toBeNull();
    expect(screen.getByText("Ready to Close")).toBeInTheDocument();
  });

  it("empty org-wide population → no review tile at all (unchanged gate)", async () => {
    vi.stubEnv("SECURELOGIC_INDEPENDENT_REVIEW_ENABLED", "true");
    // Default SUMMARY fixture has no pending_independent_review (0).
    await renderDashboard();

    expect(screen.queryByText("My Pending Reviews")).toBeNull();
    expect(screen.queryByText("Ready to Close")).toBeNull();
  });
});
