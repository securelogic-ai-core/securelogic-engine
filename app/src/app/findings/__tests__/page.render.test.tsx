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
