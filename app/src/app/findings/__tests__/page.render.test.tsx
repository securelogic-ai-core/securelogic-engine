/**
 * /findings — render contract.
 *
 * THE DEFECT THIS FILE EXISTS FOR: #638 repointed every dashboard findings link to
 * `/findings?active=true`, and the page did not read `active`. CI was 8/8 green because
 * the engine test asserted `/api/findings?active=true` — which was never what the tile
 * linked to. The first two tests below fail against that code.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import {
  renderPage,
  expectRedirect,
  signedIn,
  signedOut,
  sp,
  hrefOf,
} from "@/test/harness";
import { aFinding, aFindingsResponse, aFindingsSummary, aMe } from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  getFindings: vi.fn(),
  getFindingsSummary: vi.fn(),
  getFindingSavedViews: vi.fn(),
  getFindingsByEntity: vi.fn(),
  getSignalMatchSuggestionCounts: vi.fn(),
  getTeamMembers: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import FindingsPage from "../page";

const ACTIVE = [
  aFinding({ id: "f-1", title: "Unencrypted backups", status: "open", severity: "High" }),
  aFinding({ id: "f-2", title: "Stale IAM keys", status: "in_progress", severity: "Critical" }),
];

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getMe.mockResolvedValue(aMe({ entitlementLevel: "platform" }));
  api.getFindings.mockResolvedValue(aFindingsResponse(ACTIVE));
  api.getFindingsSummary.mockResolvedValue({ summary: aFindingsSummary() });
  api.getFindingSavedViews.mockResolvedValue([]);
  api.getFindingsByEntity.mockResolvedValue(null);
  api.getSignalMatchSuggestionCounts.mockResolvedValue(null);
  api.getTeamMembers.mockResolvedValue({ members: [] });
});

describe("/findings — the destination of every dashboard findings tile", () => {
  it("?active=true asks the engine for the ACTIVE population, not every status", async () => {
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "false");

    await renderPage(FindingsPage, { searchParams: sp({ active: "true" }) });

    // The regression: the page fell through to `status ?? "all"` → no status filter,
    // so the list served closed and accepted findings under a tile promising active ones.
    expect(api.getFindings).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ active: true })
    );
    const params = api.getFindings.mock.calls[0][1];
    expect(params.status).toBeUndefined();
  });

  it("?active=true is a VISIBLE filter — not a silent one under a highlighted 'All'", async () => {
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "false");

    const { container } = await renderPage(FindingsPage, {
      searchParams: sp({ active: "true" }),
    });

    // A filtered list rendered under a highlighted "All" pill is a silent filter — the
    // customer cannot tell why the count is smaller than the page claims to show.
    const active = container.querySelector('a[href="/findings?active=true"]');
    expect(active).not.toBeNull();
    expect(active).toHaveTextContent("Active");

    // "All" must NOT be the selected pill while the active filter is applied.
    const all = Array.from(container.querySelectorAll("a")).find(
      (a) => a.textContent?.trim() === "All"
    );
    expect(all).toBeDefined();
    expect(all?.getAttribute("href")).not.toContain("active=true");
  });

  it("preserves the active filter when the customer refines by severity", async () => {
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "false");

    const { container } = await renderPage(FindingsPage, {
      searchParams: sp({ active: "true" }),
    });

    // Refinement links must carry `active` forward, or clicking a severity silently
    // widens the population back to closed findings and the count jumps.
    const critical = hrefOf(container, /^Critical$/);
    expect(critical).toContain("active=true");
    expect(critical).toContain("severity=Critical");
  });

  it("an explicit status REPLACES the active set rather than intersecting with it", async () => {
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "false");

    const { container } = await renderPage(FindingsPage, {
      searchParams: sp({ active: "true" }),
    });

    // The engine ANDs the two, so `active=true&status=closed` renders an empty list
    // under a highlighted "Closed" pill — a dead end.
    const closed = hrefOf(container, /^Closed$/);
    expect(closed).toContain("status=closed");
    expect(closed).not.toContain("active=true");
  });

  it("renders the findings the engine returned", async () => {
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "false");

    await renderPage(FindingsPage, { searchParams: sp({ active: "true" }) });

    expect(screen.getByText(/Unencrypted backups/)).toBeInTheDocument();
    expect(screen.getByText(/Stale IAM keys/)).toBeInTheDocument();
  });
});

describe("/findings — feature-flag branches", () => {
  it("flag ON + ?active=true lands on the LIST, not the work-first landing page", async () => {
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "true");

    await renderPage(FindingsPage, { searchParams: sp({ active: "true" }) });

    // The other half of the #638 defect: `active` counted as "no filter", so the
    // work-first router sent "View all open findings" to the ops-center HOME.
    // A deep link that promises a list must produce a list.
    expect(screen.getByText(/Unencrypted backups/)).toBeInTheDocument();
    expect(api.getFindings).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ active: true })
    );
  });

  it("flag OFF renders the legacy list experience (no work-queue landing)", async () => {
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "false");

    const { container } = await renderPage(FindingsPage, { searchParams: sp({}) });

    // Legacy = the filter bar + rows, with no bucket deep links.
    expect(screen.getByText(/Unencrypted backups/)).toBeInTheDocument();
    expect(container.querySelector('a[href*="bucket="]')).toBeNull();
  });
});

describe("/findings?queue=all — executive summary restored above the scalable queue", () => {
  // The regression: when the scalable queue controls (SECURELOGIC_FINDINGS_QUEUE_
  // CONTROLS_ENABLED) shipped, the browse queue rendered search/filters/cards with
  // NO page-level operational overview above them. These tests pin the restored
  // summary AND that the queue controls still render beneath it.
  beforeEach(() => {
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "false");
    vi.stubEnv("SECURELOGIC_FINDINGS_QUEUE_CONTROLS_ENABLED", "true");
  });

  const RICH_SUMMARY = () =>
    aFindingsSummary({
      active_total: 3,
      overdue_open: 4,
      pending_risk_approvals: 2,
      ready_for_decision_open: 5,
      accepted_risk_total: 6,
    });

  it("renders the five validated summary metrics above the toolbar", async () => {
    api.getFindingsSummary.mockResolvedValue({ summary: RICH_SUMMARY() });

    const { container } = await renderPage(FindingsPage, { searchParams: sp({ queue: "all" }) });

    for (const label of [
      "Active Findings",
      "Overdue / SLA",
      "Awaiting Approval",
      "Ready to Close",
      "Accepted Risk",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // The summary section exists, is labelled, and reads the TENANT-WIDE totals.
    const summary = container.querySelector('section[aria-label="Findings summary"]');
    expect(summary).not.toBeNull();
    expect(summary!.textContent).toContain("3"); // active_total
    expect(summary!.textContent).toContain("6"); // accepted_risk_total

    // The scalable queue controls still render — the summary did not replace them.
    const toolbar = screen.getByLabelText("Search findings");
    expect(toolbar).toBeInTheDocument();

    // …and the summary is ABOVE the toolbar in the document (overview first).
    expect(
      summary!.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("summary totals stay TENANT-WIDE when search/filters narrow the queue", async () => {
    api.getFindingsSummary.mockResolvedValue({ summary: RICH_SUMMARY() });
    // The queue result set is narrowed to a single row by the filters…
    api.getFindings.mockResolvedValue(aFindingsResponse([ACTIVE[0]!], { total: 1 }));

    const { container } = await renderPage(FindingsPage, {
      searchParams: sp({ queue: "all", q: "backups", severity: "High", operational_status: "in_progress" }),
    });

    // …but the executive summary is org-wide: it still reads active_total (3), not
    // the 1-row filtered result set.
    const summary = container.querySelector('section[aria-label="Findings summary"]');
    expect(summary!.textContent).toContain("3");

    // The summary is computed from getFindingsSummary(token) — which takes NO filter
    // arguments — so a user's search can never silently move the executive totals.
    expect(api.getFindingsSummary).toHaveBeenCalled();
    const summaryArgs = api.getFindingsSummary.mock.calls[0];
    expect(summaryArgs.length).toBe(1); // token only — no q / severity / status
  });

  it("Operations Center and All Findings summaries reconcile — same calc, same terminology", async () => {
    const summary = aFindingsSummary({ active_total: 7, accepted_risk_total: 9 });
    api.getFindingsSummary.mockResolvedValue({ summary });

    // Browse queue (flag on, RISK_WORKSPACE off) — the All Findings summary.
    const browse = await renderPage(FindingsPage, { searchParams: sp({ queue: "all" }) });
    const browseSummary = browse.container.querySelector('section[aria-label="Findings summary"]')!;
    expect(browseSummary.textContent).toContain("Active Findings");
    expect(browseSummary.textContent).toContain("7");

    // Operations Center HOME (RISK_WORKSPACE on, no browse) — the same summary bar,
    // from the same globalSummary() over the same org-wide summary.
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "true");
    const ops = await renderPage(FindingsPage, { searchParams: sp({}) });
    const opsSummary = ops.container.querySelector('section[aria-label="Findings summary"]')!;
    expect(opsSummary.textContent).toContain("Active Findings");
    expect(opsSummary.textContent).toContain("7"); // identical value + label → reconciled
  });
});

describe("/findings — authorization", () => {
  it("sends a signed-out visitor to /login", async () => {
    signedOut();
    expect(await expectRedirect(FindingsPage, { searchParams: sp({}) })).toBe("/login");
  });

  it("sends a non-platform (unentitled) user to /dashboard, not into the page", async () => {
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "starter" }));
    expect(await expectRedirect(FindingsPage, { searchParams: sp({}) })).toBe("/dashboard");
  });
});

/**
 * The tile, not the filter pill. Both are labelled "Active" — the pill is an <a>,
 * the tile label is a <p> — so a bare getByText finds two nodes.
 */
function tile(label: string): HTMLElement {
  const labelNode = screen
    .getAllByText(label)
    .find((el) => el.tagName === "P");
  if (!labelNode) throw new Error(`no tile labelled "${label}"`);
  return labelNode.parentElement as HTMLElement;
}

describe("/findings — the summary tiles count the ACTIVE population", () => {
  it("the tiles read the ACTIVE fields, never the strictly-open twins", async () => {
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "false");
    // The fixture deliberately disagrees: active_total 3 vs open_count 2, and
    // critical_active 2 vs critical_open 1. A tile still reading the strictly-open
    // field renders 2 and 1 — which is exactly what shipped before this convergence.
    const { container } = await renderPage(FindingsPage, { searchParams: sp({}) });

    expect(tile("Active").textContent).toContain("3");   // active_total, not open_count (2)
    expect(tile("Critical").textContent).toContain("2"); // critical_active, not critical_open (1)
    expect(tile("High").textContent).toContain("1");

    // The old label is gone — the word "Open" must not head an enterprise tile.
    expect(container.textContent).not.toContain("Open Findings");
  });

  it("an org whose findings are ALL in progress still shows a non-zero Active tile", async () => {
    // The strictly-open regression, stated as a customer scenario: a team that has
    // started work on every finding used to see a tile of 0 and a clean board.
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "false");
    api.getFindingsSummary.mockResolvedValue({
      summary: aFindingsSummary({
        open_count: 0, critical_open: 0, high_open: 0,
        active_total: 5, critical_active: 3, high_active: 2,
      }),
    });

    await renderPage(FindingsPage, { searchParams: sp({}) });

    expect(tile("Active").textContent).toContain("5");
    expect(tile("Critical").textContent).toContain("3");
    expect(tile("High").textContent).toContain("2");
  });
});

describe("/findings — the summary tiles are doors to their exact populations", () => {
  // Metric Contract, final step (same defect class as #638): a number a reader
  // trusts must LINK to the population it counts. Severity tiles count the
  // *_active fields, so their doors carry both axes; the bare severity pill
  // (which includes closed findings) is NOT an acceptable landing.
  const tileHref = (label: string) => tile(label).closest("a")?.getAttribute("href");

  it("each tile links to precisely the population its number counts", async () => {
    await renderPage(FindingsPage, { searchParams: sp({}) });

    expect(tileHref("Active")).toBe("/findings?active=true");
    expect(tileHref("Critical")).toBe("/findings?active=true&severity=Critical");
    expect(tileHref("High")).toBe("/findings?active=true&severity=High");
    expect(tileHref("Moderate")).toBe("/findings?active=true&severity=Moderate");
    expect(tileHref("Low")).toBe("/findings?active=true&severity=Low");
    // In Progress counts in_progress_open — the status filter expresses it exactly.
    expect(tileHref("In Progress")).toBe("/findings?status=in_progress");
  });

  it("tile doors REPLACE current filters — never intersect into a different population", async () => {
    // Reading "Critical N" while filtered to Low must still open the critical
    // active list, not Low∩Critical (an empty lie) or Critical-including-closed.
    await renderPage(FindingsPage, { searchParams: sp({ severity: "Low", status: "open" }) });

    expect(tileHref("Critical")).toBe("/findings?active=true&severity=Critical");
    expect(tileHref("Active")).toBe("/findings?active=true");
  });

  it("tiles are labeled for assistive tech with count and population", async () => {
    await renderPage(FindingsPage, { searchParams: sp({}) });

    // critical_active defaults to 2 in aFindingsSummary — the label carries the
    // same number the sighted reader sees.
    expect(
      screen.getByRole("link", { name: "2 active critical findings — view the list" })
    ).toBeInTheDocument();
  });
});

describe("/findings — an outage never impersonates an empty result", () => {
  // getFindings returns null ONLY on failure (success-empty is {findings: []}).
  // Before this contract, an engine error rendered the filtered-empty message
  // and — when the summary also failed — six confident zeros above it.
  it("a failed findings fetch renders the loading-problem alert, not 'no findings match'", async () => {
    api.getFindings.mockResolvedValue(null);

    const { container } = await renderPage(FindingsPage, { searchParams: sp({}) });
    const text = container.textContent ?? "";

    expect(screen.getByRole("alert").textContent).toContain("Findings couldn’t be loaded right now");
    expect(text).toContain("not an empty list — your findings are unchanged");
    expect(text).toContain("Try again");
    expect(text).not.toContain("No findings match");
  });

  it("when every count source fails, tiles show an honest — instead of fabricated zeros", async () => {
    api.getFindings.mockResolvedValue(null);
    api.getFindingsSummary.mockResolvedValue(null);

    await renderPage(FindingsPage, { searchParams: sp({}) });

    expect(tile("Critical").textContent).toContain("—");
    expect(tile("Critical").textContent).not.toContain("0");
    expect(
      screen.getByRole("link", { name: "Critical count unavailable right now — view the list" })
    ).toBeInTheDocument();
  });

  it("summary-only failure keeps the documented slice fallback — counts, not dashes", async () => {
    // Old-engine builds omit the summary; the slice under-reports rather than
    // lying with an em-dash while findings are visibly listed below.
    api.getFindingsSummary.mockResolvedValue(null);

    const { container } = await renderPage(FindingsPage, { searchParams: sp({}) });

    expect(tile("Critical").textContent).toContain("1"); // ACTIVE fixture has 1 critical
    expect(container.textContent).not.toContain("couldn’t be loaded");
  });

  it("a genuinely empty result still reads as an answer, not an error", async () => {
    api.getFindings.mockResolvedValue(aFindingsResponse([]));

    const { container } = await renderPage(FindingsPage, { searchParams: sp({}) });

    expect(container.textContent).toContain("No findings match your current filters");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
