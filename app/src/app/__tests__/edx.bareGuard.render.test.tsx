/**
 * EDX-1 cross-surface outage contract — wave 2, the BARE-GUARD consumers.
 *
 * The six surfaces in edx.outage.render.test.tsx at least had a `=== null`
 * branch; its sentence was just false. These seven had no branch at all. Every
 * one of them wrote `data?.rows ?? []` and then rendered its ordinary empty
 * state, so a 500, a timeout or a dropped connection came out as a confident
 * statement about the customer's own data:
 *
 *   /risks       → "No risks match your current filters."
 *   /actions     → "All clear — no open actions."
 *   /frameworks  → "No frameworks activated yet."   (+ a per-card
 *                   "Loading readiness…" printed by a SERVER component for a
 *                   fetch that had already failed and would never complete)
 *   /queue       → "SecureLogic hasn't found any links ... yet"
 *   /audit-log   → "No audit events found."
 *   /dashboard   → "No briefs published yet."       (legacy + Briefing layouts)
 *
 * These are not interchangeable in severity. "All clear" is the sentence most
 * likely to end someone's check on outstanding work, and an audit log that
 * reports no events is evidence of the wrong fact to the exact audience that
 * opens it to establish whether something happened.
 *
 * The file sits beside the surfaces rather than inside any one of them because
 * what it defends is the PATTERN: no read surface may present a failed fetch as
 * an answer about the customer's data.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, signedIn } from "@/test/harness";

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  getAuthMe: vi.fn(),
  getRisks: vi.fn(),
  getRisksIntelligence: vi.fn(),
  getRisksSummary: vi.fn(),
  getRiskScale: vi.fn(),
  getActions: vi.fn(),
  getActionsSummary: vi.fn(),
  getFrameworks: vi.fn(),
  getFrameworkReadiness: vi.fn(),
  getSignalMatchSuggestions: vi.fn(),
  getSignalMatchSuggestionCounts: vi.fn(),
  getAuditLog: vi.fn(),
  getAuditLogEventTypes: vi.fn(),
  getTeamMembers: vi.fn(),
  getIssues: vi.fn(),
  getLatestBrief: vi.fn(),
  getDashboardSummary: vi.fn(),
  getPostureHistory: vi.fn(),
  getFindings: vi.fn(),
  getFindingsSummary: vi.fn(),
  getDashboardPreferences: vi.fn(),
  getBriefingLayout: vi.fn(),
  getBriefingChanges: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import RisksPage from "../risks/page";
import ActionsPage from "../actions/page";
import FrameworksPage from "../frameworks/page";
import QueuePage from "../queue/page";
import AuditLogPage from "../audit-log/page";
import DashboardPage from "../dashboard/page";

const noParams = { searchParams: Promise.resolve({}) };

type Surface = {
  name: string;
  subject: RegExp;
  /** The false reading this surface's data genuinely rules out. */
  denial: RegExp;
  /** The exact empty-state sentence that must NOT appear during an outage. */
  falsehood: RegExp;
  render: () => Promise<unknown>;
  retry: string;
};

const SURFACES: Surface[] = [
  {
    name: "/risks",
    subject: /Your risk register couldn’t be loaded right now/,
    denial: /not an empty register, and not a filter that matched nothing/,
    falsehood: /No risks match your current filters/,
    render: () => renderPage(RisksPage, noParams),
    retry: "/risks",
  },
  {
    name: "/actions",
    subject: /Your remediation actions couldn’t be loaded right now/,
    denial: /not an all-clear, and not an empty queue/,
    falsehood: /All clear — no open actions/,
    render: () => renderPage(ActionsPage, noParams),
    retry: "/actions",
  },
  {
    name: "/frameworks",
    subject: /Your frameworks couldn’t be loaded right now/,
    denial: /not a sign that no frameworks are activated/,
    falsehood: /No frameworks activated yet/,
    render: () => renderPage(FrameworksPage, undefined as never),
    retry: "/frameworks",
  },
  {
    name: "/queue",
    subject: /Suggested links couldn’t be loaded right now/,
    denial: /not an empty review queue/,
    falsehood: /hasn’t found any links|hasn't found any links|matcher hasn’t produced|matcher hasn't produced/,
    render: () => renderPage(QueuePage, noParams),
    retry: "/queue",
  },
  {
    name: "/audit-log",
    subject: /The audit log couldn’t be loaded right now/,
    denial: /not an absence of audit events/,
    falsehood: /No audit events found/,
    render: () => renderPage(AuditLogPage, noParams),
    retry: "/audit-log",
  },
  {
    name: "/dashboard (latest brief)",
    subject: /Your latest brief couldn’t be loaded right now/,
    denial: /not a sign that no brief has been published/,
    falsehood: /No briefs published yet/,
    render: () => renderPage(DashboardPage, { searchParams: Promise.resolve({}) }),
    retry: "/dashboard",
  },
];

/** Every reader fails — the outage all seven surfaces used to report as data. */
function allFetchesFail(): void {
  for (const [name, fn] of Object.entries(api)) {
    // getLatestBrief no longer speaks in null: it must SAY that it failed,
    // which is the whole point of the reader-level change behind /dashboard.
    fn.mockResolvedValue(name === "getLatestBrief" ? { state: "unavailable" } : null);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "false");
  // /audit-log is admin-gated; the rest are unaffected by the role.
  signedIn({ entitlementLevel: "platform", userRole: "admin" });
  allFetchesFail();
  api.getMe.mockResolvedValue({ entitlementLevel: "platform", organizationName: "Acme" });
});

describe("EDX-1 wave 2 — a failed read is never rendered as an answer", () => {
  for (const s of SURFACES) {
    describe(s.name, () => {
      it("does not print its empty state — the sentence that made an outage look like data", async () => {
        await s.render();
        expect(document.body.textContent).not.toMatch(s.falsehood);
      });

      it("names the subject and announces the failure assertively", async () => {
        await s.render();
        const alerts = screen.getAllByRole("alert");
        expect(alerts.some((a) => s.subject.test(a.textContent ?? ""))).toBe(true);
      });

      it("denies the false reading the data actually rules out", async () => {
        await s.render();
        const alerts = screen.getAllByRole("alert");
        expect(alerts.some((a) => s.denial.test(a.textContent ?? ""))).toBe(true);
      });

      it("offers a retry that lands back on this surface", async () => {
        await s.render();
        const links = screen.getAllByRole("link", { name: /try again/i });
        expect(links.some((l) => l.getAttribute("href") === s.retry)).toBe(true);
      });

      it("does not blame the customer's plan", async () => {
        await s.render();
        expect(document.body.textContent).not.toMatch(/not available for your current plan/i);
      });
    });
  }
});

describe("EDX-1 wave 2 — a successful empty response is still an answer", () => {
  it("/audit-log: zero events is an ANSWER, not an outage", async () => {
    api.getAuditLog.mockResolvedValue({ events: [], total: 0, total_pages: 1 });

    await renderPage(AuditLogPage, noParams);

    expect(screen.getByText(/No audit events found/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("/actions: an empty queue really is all clear", async () => {
    api.getActions.mockResolvedValue({ count: 0, total: 0, actions: [] });
    api.getActionsSummary.mockResolvedValue({
      open_count: 0, open_only_count: 0, in_progress_count: 0,
      blocked_count: 0, overdue_count: 0, immediate_count: 0, closed_count: 0,
    });

    await renderPage(ActionsPage, noParams);

    expect(screen.getByText(/All clear — no open actions/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("/frameworks: nothing activated is an ANSWER, not an outage", async () => {
    api.getFrameworks.mockResolvedValue({ frameworks: [] });

    await renderPage(FrameworksPage, undefined as never);

    expect(screen.getByText(/No frameworks activated yet/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("/queue: a matcher that has genuinely produced nothing may say so", async () => {
    api.getSignalMatchSuggestions.mockResolvedValue({ suggestions: [] });
    api.getSignalMatchSuggestionCounts.mockResolvedValue({
      total: 0,
      lifetime_total: 0,
      by_target_type: { vendor: 0, ai_system: 0, control: 0, obligation: 0 },
    });

    await renderPage(QueuePage, noParams);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.body.textContent).toMatch(/hasn’t produced|hasn't produced/);
  });

  it("/queue: a FAILED counts read must not be read as 'never seen a suggestion'", async () => {
    // The list succeeded and is empty; only /counts failed. `lifetime_total ?? 0`
    // turned that into the strongest possible claim about the org's history.
    api.getSignalMatchSuggestions.mockResolvedValue({ suggestions: [] });
    api.getSignalMatchSuggestionCounts.mockResolvedValue(null);

    await renderPage(QueuePage, noParams);

    expect(document.body.textContent).not.toMatch(/hasn’t produced any|hasn't produced any/);
    expect(document.body.textContent).not.toMatch(/hasn’t found any|hasn't found any/);
  });
});

describe("EDX-1 wave 2 — getLatestBrief discriminates, so the dashboard can", () => {
  it("a successful read with no briefs still says none are published", async () => {
    api.getLatestBrief.mockResolvedValue({ state: "none" });
    api.getIssues.mockResolvedValue({ count: 0, issues: [] });

    await renderPage(DashboardPage, { searchParams: Promise.resolve({}) });

    expect(screen.getByText(/No briefs published yet/)).toBeInTheDocument();
  });

  it("a brief that exists but whose detail read failed is NOT 'none published'", async () => {
    // The list said a brief exists. Reporting "none published" because the
    // second request failed contradicts evidence the page already holds.
    api.getLatestBrief.mockResolvedValue({ state: "unavailable" });
    api.getIssues.mockResolvedValue({ count: 0, issues: [] });

    await renderPage(DashboardPage, { searchParams: Promise.resolve({}) });

    expect(screen.queryByText(/No briefs published yet/)).toBeNull();
    expect(
      screen.getAllByRole("alert").some((a) =>
        /Your latest brief couldn’t be loaded/.test(a.textContent ?? "")
      )
    ).toBe(true);
  });
});

describe("EDX-1 wave 2 — /frameworks readiness is unknown, not loading and not zero", () => {
  it("a failed per-framework readiness read stops claiming it is still loading", async () => {
    api.getFrameworks.mockResolvedValue({
      frameworks: [{ id: "fw-1", name: "NIST CSF", version: "2.0" }],
    });
    api.getFrameworkReadiness.mockResolvedValue(null);

    await renderPage(FrameworksPage, undefined as never);

    // A SERVER component cannot leave a "loading" state: the fetch already
    // failed, so the spinner-shaped sentence never resolves.
    expect(document.body.textContent).not.toMatch(/Loading readiness/);
    expect(screen.getByTitle(/Readiness is unavailable/)).toBeInTheDocument();
  });
});
