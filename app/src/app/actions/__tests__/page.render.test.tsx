/**
 * /actions — render contract (Actions / My Work).
 *
 * This is the destination of every dashboard Actions link (orgActionsHref → ?view=team)
 * AND the caller's personal remediation queue (?view=mine). The two must never be
 * confused: an ORG-WIDE count may not land in a USER-SCOPED view, and a user-scoped
 * view may not silently render org-wide data.
 *
 * Metric Contract (src/api/lib/metricDefinitions.ts):
 *   active   = open | in_progress | blocked   (blocked work is still work)
 *   terminal = closed | accepted
 * A surface that promises "open actions" must not count or list terminal ones.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import {
  renderPage,
  expectRedirect,
  signedIn,
  signedOut,
  apiKeyOnly,
  sp,
  hrefs,
  hrefOf,
} from "@/test/harness";
import { aMe, anAction, anActionsResponse, anActionsSummary } from "@/test/fixtures";
import type { Action } from "@/lib/api";

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  getActions: vi.fn(),
  getActionsSummary: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import ActionsPage from "../page";
import { orgActionsHref } from "../myActions";

/** The searchParams Next would hand the page for a URL the app itself renders. */
function paramsOf(href: string): Promise<Record<string, string | undefined>> {
  return sp(Object.fromEntries(new URL(href, "https://x").searchParams));
}

/**
 * The EXACT number under a stat tile. Substring matching would let "12" satisfy an
 * assertion of "1" — precisely the class of drift these tests exist to catch.
 */
function tileValue(container: HTMLElement, label: string): string {
  const heading = Array.from(container.querySelectorAll("p")).find(
    (p) => p.textContent?.trim() === label
  );
  if (!heading) throw new Error(`No stat tile labelled "${label}"`);
  return heading.nextElementSibling?.textContent?.trim() ?? "";
}

const MINE = anAction({
  id: "a-mine",
  title: "Rotate the eu-west-1 backup keys",
  owner_user_id: "user-1",
  status: "open",
  source_type: "finding",
  source_id: "f-1",
});

const THEIRS = anAction({
  id: "a-theirs",
  title: "Someone else's vendor review",
  owner_user_id: "user-99",
  status: "in_progress",
  source_type: "finding",
  source_id: "f-2",
});

const UNASSIGNED = anAction({
  id: "a-unassigned",
  title: "Unowned firewall rule cleanup",
  owner_user_id: null,
  status: "blocked",
});

const ORG_ACTIONS = [MINE, THEIRS, UNASSIGNED];

/**
 * Stand in for the ENGINE, which is now what scopes a personal queue: `?owner=me`
 * is resolved from the session server-side and applied in SQL. The mock honours it
 * so "a user-scoped view never shows the org's work" is still proven end-to-end —
 * through the mechanism that actually enforces it, rather than a client-side filter
 * that could only ever narrow the ≤100 rows it happened to be handed.
 */
beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getMe.mockResolvedValue(aMe({ entitlementLevel: "platform" }));
  api.getActions.mockImplementation((_token: unknown, params?: { owner?: string }) =>
    Promise.resolve(
      anActionsResponse(
        params?.owner === "me"
          ? ORG_ACTIONS.filter((a) => a.owner_user_id === "user-1")
          : ORG_ACTIONS
      )
    )
  );
  api.getActionsSummary.mockResolvedValue(anActionsSummary());
});

// ── 1. Flag OFF — the legacy org-wide list ────────────────────────────────────

describe("/actions — workspace flag OFF (legacy list)", () => {
  beforeEach(() => vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "false"));

  it("renders the legacy list in place — a bare /actions does NOT redirect", async () => {
    await renderPage(ActionsPage, { searchParams: sp({}) });

    expect(screen.getByRole("heading", { name: "Remediation Actions" })).toBeInTheDocument();
    // The workspace scope tabs belong to the flag-ON view only. No mixed state.
    expect(screen.queryByText("Assigned to me")).not.toBeInTheDocument();
  });

  it("an empty, unfiltered list is an honest 'all clear' that says where actions come from", async () => {
    api.getActions.mockResolvedValue(anActionsResponse([]));

    const { container } = await renderPage(ActionsPage, { searchParams: sp({}) });

    expect(screen.getByText("All clear — no open actions.")).toBeInTheDocument();
    expect(
      screen.getByText("Actions are created when findings require remediation.")
    ).toBeInTheDocument();
    // Not a dead end: the filter bar is still navigable out of the empty state.
    expect(hrefs(container).length).toBeGreaterThan(0);
  });

  it("an empty FILTERED list says the filter is empty — not that the org is all clear", async () => {
    api.getActions.mockResolvedValue(anActionsResponse([]));

    await renderPage(ActionsPage, { searchParams: sp({ status: "blocked" }) });

    // "All clear" under an applied filter is a fake zero: the org may have plenty
    // of open work that simply is not blocked.
    expect(screen.getByText("No actions match your current filters.")).toBeInTheDocument();
    expect(screen.queryByText("All clear — no open actions.")).not.toBeInTheDocument();
  });

  it("honours ?active=true so the dashboard's ACTIVE tile can reproduce its number", async () => {
    await renderPage(ActionsPage, { searchParams: sp({ active: "true", view: "team" }) });

    // The tile links to orgActionsHref({active:true}) in BOTH flag states. With the
    // flag off, `view=team` is inert but `active` must still filter — otherwise the
    // destination lists closed and accepted actions under a heading promising N active.
    const params = api.getActions.mock.calls[0][1];
    expect(params.active).toBe(true);
    expect(params.status).toBeUndefined();
  });

  it("every rendered link has a real destination", async () => {
    const { container } = await renderPage(ActionsPage, { searchParams: sp({}) });

    const all = hrefs(container);
    expect(all.length).toBeGreaterThan(0);
    for (const href of all) {
      expect(href).not.toBe("");
      expect(href).not.toBe("#");
      expect(href.startsWith("/") || href.startsWith("http")).toBe(true);
    }
  });
});

// ── 1b. Flag OFF — the legacy tiles are EXACT server counts ──────────────────
//
// This is the PRODUCTION-visible path (SECURELOGIC_DECISION_WORKSPACE_ENABLED is
// false in prod, true on staging), so it is the one place where deterministic
// tests are the only proof available: a staging walkthrough renders Path B and
// cannot exercise any of this.
//
// Every tile here derived its number from `actions.filter(…).length` — a scan of
// a page the engine caps at 100. That arithmetic is CORRECT below the cap, which
// is exactly why it survived review: the tiles only begin lying once an org has
// more than one page of matching work. So every population below is seeded PAST
// the cap, and each assertion is about a number the page cannot have counted.

const EM_DASH = "—";

describe("/actions — legacy tiles are exact server counts (Path A)", () => {
  beforeEach(() => vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "false"));

  /** A full page, which is all the engine will ever hand this route. */
  const CAPPED_PAGE = Array.from({ length: 100 }, (_, i) =>
    anAction({ id: `a-${i}`, title: `Action ${i}`, status: "open" })
  );

  /**
   * An engine holding `total` matching actions, of which `immediate`/`nearTerm`
   * carry those priorities. The priority totals are answered through the list
   * route's exact `total`, so the mock must key on the priority param the page
   * sends — the same discrimination the engine performs in SQL.
   */
  function engine({
    total = 340,
    immediate = 22,
    nearTerm = 31,
    rows = CAPPED_PAGE,
  }: { total?: number; immediate?: number; nearTerm?: number; rows?: Action[] } = {}) {
    api.getActions.mockImplementation((_t: unknown, p?: { priority?: string }) => {
      if (p?.priority === "immediate")
        return Promise.resolve({ ...anActionsResponse([]), total: immediate });
      if (p?.priority === "near_term")
        return Promise.resolve({ ...anActionsResponse([]), total: nearTerm });
      return Promise.resolve({ ...anActionsResponse(rows), total });
    });
  }

  const BIG_SUMMARY = { open_only_count: 180, in_progress_count: 25, overdue_count: 47 };

  it("counts the whole population past the 100-row cap, not the slice it was handed", async () => {
    engine({ total: 340, immediate: 22, nearTerm: 31 });
    api.getActionsSummary.mockResolvedValue(anActionsSummary(BIG_SUMMARY));

    const { container } = await renderPage(ActionsPage, { searchParams: sp({}) });

    // Scanning the 100 returned rows yields 100 / 0 / 0 — a capped number wearing
    // a total's clothes, directly above a "Showing 100 of 340" line disclosing the
    // truncation of the list but not of the tiles.
    expect(tileValue(container, "Open")).toBe("205");
    expect(tileValue(container, "Overdue")).toBe("47");
    expect(tileValue(container, "High Priority")).toBe("53");
    expect(screen.getByText(/Showing 100 of 340/)).toBeInTheDocument();
  });

  it("the size of the returned slice moves no tile at all", async () => {
    api.getActionsSummary.mockResolvedValue(anActionsSummary(BIG_SUMMARY));
    const labels = ["Open", "Overdue", "High Priority"];

    engine({ rows: CAPPED_PAGE });
    const wide = await renderPage(ActionsPage, { searchParams: sp({}) });
    const fromFullPage = labels.map((l) => tileValue(wide.container, l));

    // Same population, three rows returned. Any tile that reads page length moves.
    engine({ rows: CAPPED_PAGE.slice(0, 3) });
    const narrow = await renderPage(ActionsPage, { searchParams: sp({}) });

    expect(labels.map((l) => tileValue(narrow.container, l))).toEqual(fromFullPage);
    expect(fromFullPage).toEqual(["205", "47", "53"]);
  });

  it("asks the summary for EXACTLY the filters it asks the list for, and never for a page", async () => {
    engine();
    api.getActionsSummary.mockResolvedValue(anActionsSummary(BIG_SUMMARY));

    await renderPage(ActionsPage, {
      searchParams: sp({ status: "blocked", overdue: "true" }),
    });

    const listParams = api.getActions.mock.calls[0][1];
    const summaryParams = api.getActionsSummary.mock.calls[0][1];

    expect(summaryParams.status).toBe(listParams.status);
    expect(summaryParams.overdue).toBe(listParams.overdue);
    expect(summaryParams.priority).toBe(listParams.priority);
    expect(summaryParams.active).toBe(listParams.active);
    // Pagination has no meaning for an aggregate, and an aggregate over a page is
    // the defect this whole change removes.
    expect(summaryParams).not.toHaveProperty("limit");
    expect(listParams.limit).toBe(100);
  });

  it("changing a filter changes the tiles with it — the counts are filter-scoped", async () => {
    engine();
    api.getActionsSummary.mockImplementation((_t: unknown, p?: { status?: string }) =>
      Promise.resolve(
        p?.status === "blocked"
          ? anActionsSummary({ open_only_count: 0, in_progress_count: 0, overdue_count: 9 })
          : anActionsSummary(BIG_SUMMARY)
      )
    );

    const unfiltered = await renderPage(ActionsPage, { searchParams: sp({}) });
    expect(tileValue(unfiltered.container, "Overdue")).toBe("47");

    const filtered = await renderPage(ActionsPage, { searchParams: sp({ status: "blocked" }) });
    // 9 overdue blocked actions, and — truthfully — zero of them are open or in
    // progress. A tile above a blocked list must describe the blocked list.
    expect(tileValue(filtered.container, "Overdue")).toBe("9");
    expect(tileValue(filtered.container, "Open")).toBe("0");
  });

  it("the Open tile counts open|in_progress — un-capping a number does not redefine it", async () => {
    engine();
    api.getActionsSummary.mockResolvedValue(
      anActionsSummary({
        open_only_count: 10,
        in_progress_count: 5,
        blocked_count: 7,
        open_count: 22,
        overdue_count: 0,
      })
    );

    const { container } = await renderPage(ActionsPage, { searchParams: sp({}) });

    expect(tileValue(container, "Open")).toBe("15");
    // `open_count` is ACTIVE (open|in_progress|blocked) — a different population.
    // Substituting it would change what the tile means while claiming to fix it.
    expect(tileValue(container, "Open")).not.toBe("22");
  });

  it("a genuine zero is still 0 — an empty population is an answer", async () => {
    engine({ total: 0, immediate: 0, nearTerm: 0, rows: [] });
    api.getActionsSummary.mockResolvedValue(
      anActionsSummary({ open_only_count: 0, in_progress_count: 0, overdue_count: 0 })
    );

    const { container } = await renderPage(ActionsPage, { searchParams: sp({}) });

    expect(tileValue(container, "Open")).toBe("0");
    expect(tileValue(container, "Overdue")).toBe("0");
    expect(tileValue(container, "High Priority")).toBe("0");
    expect(screen.queryByText(/shown as/)).not.toBeInTheDocument();
  });

  it("a failed summary is disclosed as unknown — it never becomes 0", async () => {
    engine();
    api.getActionsSummary.mockResolvedValue(null);

    const { container } = await renderPage(ActionsPage, { searchParams: sp({}) });

    expect(tileValue(container, "Open")).toBe(EM_DASH);
    expect(tileValue(container, "Overdue")).toBe(EM_DASH);
    expect(screen.getByText(/shown as/)).toBeInTheDocument();
    // The high-priority count comes from the list route, which did answer.
    expect(tileValue(container, "High Priority")).toBe("53");
  });

  it("a summary missing the exact parts is unknown — no fallback to scanning rows", async () => {
    engine();
    api.getActionsSummary.mockResolvedValue(
      anActionsSummary({ open_only_count: undefined, in_progress_count: undefined })
    );

    const { container } = await renderPage(ActionsPage, { searchParams: sp({}) });

    // 100 open rows are sitting right there. Counting them would produce "100",
    // which is the capped defect returning through the back door.
    expect(tileValue(container, "Open")).toBe(EM_DASH);
    expect(tileValue(container, "Open")).not.toBe("100");
  });

  it("a failed list does not fabricate a zero for the high-priority count", async () => {
    api.getActions.mockResolvedValue(null);
    api.getActionsSummary.mockResolvedValue(anActionsSummary(BIG_SUMMARY));

    const { container } = await renderPage(ActionsPage, { searchParams: sp({}) });

    expect(tileValue(container, "High Priority")).toBe(EM_DASH);
    // The summary answered, so those two tiles are still exact.
    expect(tileValue(container, "Open")).toBe("205");
  });

  it("a priority-filtered view answers High Priority from its own total — no extra count", async () => {
    // 88 immediate actions in the org; the page is filtered to exactly them.
    engine({ total: 340, immediate: 88 });
    api.getActionsSummary.mockResolvedValue(anActionsSummary(BIG_SUMMARY));

    const { container } = await renderPage(ActionsPage, {
      searchParams: sp({ priority: "immediate" }),
    });

    // The filtered population IS entirely high-priority, so its own total answers
    // the tile exactly and the two priority sub-counts are unnecessary. Note this
    // is still 88 and not 100: the list route's total, not the page it returned.
    expect(tileValue(container, "High Priority")).toBe("88");
    expect(api.getActions).toHaveBeenCalledTimes(1);
  });

  it("a planned-filtered view has a PROVABLE zero high-priority count", async () => {
    engine({ total: 88 });
    api.getActionsSummary.mockResolvedValue(anActionsSummary(BIG_SUMMARY));

    const { container } = await renderPage(ActionsPage, {
      searchParams: sp({ priority: "planned" }),
    });

    // Nothing filtered to `planned` can be immediate or near-term. Zero here is
    // derived from the filter, not assumed from an empty scan.
    expect(tileValue(container, "High Priority")).toBe("0");
    expect(api.getActions).toHaveBeenCalledTimes(1);
  });

  it("no tile is a link, so no destination can disagree with the number it shows", async () => {
    engine();
    api.getActionsSummary.mockResolvedValue(anActionsSummary(BIG_SUMMARY));

    const { container } = await renderPage(ActionsPage, { searchParams: sp({}) });

    for (const label of ["Open", "Overdue", "High Priority"]) {
      const heading = Array.from(container.querySelectorAll("p")).find(
        (p) => p.textContent?.trim() === label
      )!;
      expect(heading.closest("div")!.querySelectorAll("a")).toHaveLength(0);
    }
  });
});

// ── 2. Flag ON — the Decision Workspace remediation queue ─────────────────────

describe("/actions — workspace flag ON", () => {
  beforeEach(() => vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "true"));

  it("a bare /actions redirects to the canonical My Actions view", async () => {
    expect(await expectRedirect(ActionsPage, { searchParams: sp({}) })).toBe("/actions?view=mine");
  });

  it("an unrecognized ?view is not a silent org-wide list — it redirects to ?view=mine", async () => {
    expect(await expectRedirect(ActionsPage, { searchParams: sp({ view: "everything" }) })).toBe(
      "/actions?view=mine"
    );
  });

  it("?view=mine renders the workspace queue, not the legacy list", async () => {
    await renderPage(ActionsPage, { searchParams: sp({ view: "mine" }) });

    expect(screen.getByRole("heading", { name: "My Actions" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Remediation Actions" })).not.toBeInTheDocument();
  });

  it("an empty My Actions is an honest, guiding empty state with a way out", async () => {
    api.getActions.mockResolvedValue(anActionsResponse([]));

    const { container } = await renderPage(ActionsPage, { searchParams: sp({ view: "mine" }) });

    expect(screen.getByText("All clear — no remediation assigned to you.")).toBeInTheDocument();
    expect(
      screen.getByText("Actions are created when a finding requires remediation.")
    ).toBeInTheDocument();
    // Not a dead end: the caller can still reach the org-wide queue from here.
    expect(hrefOf(container, "All open")).toBe("/actions?view=team");
  });

  it("every rendered link in the workspace view has a real destination", async () => {
    const { container } = await renderPage(ActionsPage, { searchParams: sp({ view: "team" }) });

    const all = hrefs(container);
    expect(all.length).toBeGreaterThan(0);
    for (const href of all) {
      expect(href).not.toBe("");
      expect(href).not.toBe("#");
      expect(href.startsWith("/")).toBe(true);
    }
  });

  it("a row deep-links into the source it remediates — the queue is not a dead end", async () => {
    const { container } = await renderPage(ActionsPage, { searchParams: sp({ view: "mine" }) });

    expect(hrefOf(container, "Rotate the eu-west-1 backup keys")).toBe("/findings/f-1");
  });

  it("Path B's summary request is unchanged — the Path A filter work did not leak into it", async () => {
    await renderPage(ActionsPage, { searchParams: sp({ view: "team", status: "blocked" }) });

    // getActionsSummary now ACCEPTS filters, and the workspace view deliberately
    // still sends none: its tiles are org-wide by design and its disclosure text
    // says so. Making the summary filterable must not silently re-scope a view
    // that was never asked to change.
    expect(api.getActionsSummary).toHaveBeenCalledTimes(1);
    expect(api.getActionsSummary.mock.calls[0][1]).toBeUndefined();
  });
});

// ── 3. Enterprise (org) vs user scope ────────────────────────────────────────

describe("/actions — user-scoped My Work vs org-scoped enterprise counts", () => {
  beforeEach(() => vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "true"));

  it("?view=mine shows ONLY the caller's actions — never the org-wide population", async () => {
    await renderPage(ActionsPage, { searchParams: sp({ view: "mine" }) });

    expect(screen.getByText("Rotate the eu-west-1 backup keys")).toBeInTheDocument();
    // The org's other work must not surface in a personal queue.
    expect(screen.queryByText("Someone else's vendor review")).not.toBeInTheDocument();
    expect(screen.queryByText("Unowned firewall rule cleanup")).not.toBeInTheDocument();
  });

  it("?view=mine asks the ENGINE to scope the queue — it does not filter a fetched page", async () => {
    await renderPage(ActionsPage, { searchParams: sp({ view: "mine" }) });

    // The scoping must happen in SQL. Filtering client-side can only narrow the rows the
    // engine chose to return, and it caps a page at 100 — so in an org with more actions
    // than that, a user's own assigned work could fall outside the page and never render,
    // with nothing disclosing the loss. Asking for owner=me is what makes the personal
    // queue correct at scale.
    expect(api.getActions.mock.calls[0][1].owner).toBe("me");
  });

  it("?view=mine never renders an ORG-WIDE count — the tiles read the caller's own counts", async () => {
    api.getActionsSummary.mockResolvedValue(
      anActionsSummary({ open_count: 12, overdue_count: 4, my_open_count: 1, my_overdue_count: 0 })
    );

    const { container } = await renderPage(ActionsPage, { searchParams: sp({ view: "mine" }) });

    // The org is carrying 12 active / 4 overdue. The caller owns ONE action and is overdue
    // on none. "My Actions / Open: 12" would hand someone else's backlog to a person as
    // their own — an enterprise metric in a user-scoped view.
    expect(tileValue(container, "Open")).toBe("1");
    expect(tileValue(container, "Overdue")).toBe("0");
  });

  it("a personal queue discloses its own truncation — 'Showing N of M' is not team-only", async () => {
    // The caller owns 140 actions; the engine's page cap returns far fewer. A personal
    // queue that renders a partial page and says nothing is the silent-loss bug.
    api.getActionsSummary.mockResolvedValue(anActionsSummary({ my_open_count: 140 }));
    api.getActions.mockResolvedValue({ ...anActionsResponse([MINE]), total: 140 });

    await renderPage(ActionsPage, { searchParams: sp({ view: "mine" }) });

    expect(screen.getByText(/Showing 1 of 140/)).toBeInTheDocument();
  });

  it("the enterprise Actions link (orgActionsHref) does NOT route into the user-scoped view", async () => {
    const href = orgActionsHref({ active: true });
    expect(href).toContain("view=team");

    const { container } = await renderPage(ActionsPage, { searchParams: paramsOf(href) });

    // It must land on the ORG-WIDE queue, showing work owned by other people.
    expect(screen.getByRole("heading", { name: "Remediation" })).toBeInTheDocument();
    expect(screen.getByText("Someone else's vendor review")).toBeInTheDocument();
    expect(hrefOf(container, "All open")).toBe("/actions?view=team");
  });

  it("the org-wide tiles read the authoritative server COUNTs, not the fetched slice", async () => {
    // Slice = 3 rows; the org actually has 12 active / 4 overdue. A tile that scans the
    // page slice cannot reconcile with the dashboard ring.
    api.getActionsSummary.mockResolvedValue(
      anActionsSummary({ open_count: 12, overdue_count: 4 })
    );

    const { container } = await renderPage(ActionsPage, { searchParams: sp({ view: "team" }) });

    expect(tileValue(container, "Open")).toBe("12");
    expect(tileValue(container, "Overdue")).toBe("4");
  });

  it("an API-key caller (no user identity) gets NO org-wide data in the user-scoped view", async () => {
    apiKeyOnly();

    await renderPage(ActionsPage, { searchParams: sp({ view: "mine" }) });

    // There is no "me" for an API key, so "assigned to me" is unanswerable. It must
    // fail CLOSED — not fall through to the org's actions.
    expect(screen.queryByText("Rotate the eu-west-1 backup keys")).not.toBeInTheDocument();
    expect(screen.queryByText("Someone else's vendor review")).not.toBeInTheDocument();
    expect(screen.queryByText("Unowned firewall rule cleanup")).not.toBeInTheDocument();
    // It does not even ask: an unanswerable question is answered with an empty queue,
    // never by widening the scope. (The engine rejects owner=me without a session
    // identity too — resolveOwnerMeFilter — so this fails closed at both layers.)
    expect(api.getActions).not.toHaveBeenCalled();
    expect(api.getActionsSummary).not.toHaveBeenCalled();
  });
});

// ── 4. The Metric Contract: active = open|in_progress|blocked ────────────────

describe("/actions — agrees with the Actions metric contract", () => {
  beforeEach(() => vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "true"));

  it("counts BLOCKED work as open, and terminal (closed/accepted) work as not open", async () => {
    const mine = [
      anAction({ id: "m1", title: "Open item", owner_user_id: "user-1", status: "open" }),
      anAction({ id: "m2", title: "In flight item", owner_user_id: "user-1", status: "in_progress" }),
      anAction({ id: "m3", title: "Blocked item", owner_user_id: "user-1", status: "blocked" }),
      anAction({ id: "m4", title: "Closed item", owner_user_id: "user-1", status: "closed" }),
      anAction({ id: "m5", title: "Accepted item", owner_user_id: "user-1", status: "accepted" }),
    ];
    api.getActions.mockResolvedValue(anActionsResponse(mine));
    // An engine build that predates my_*: the tiles fall back to deriving from the slice,
    // which is where this client-side contract still lives.
    api.getActionsSummary.mockResolvedValue(
      anActionsSummary({ my_open_count: undefined, my_overdue_count: undefined, open_count: 12 })
    );

    const { container } = await renderPage(ActionsPage, { searchParams: sp({ view: "mine" }) });

    // active = open | in_progress | blocked → 3. Not 5 (terminal work is done) and
    // not 2 (blocked work is still work — the whole point of ACTION_ACTIVE_STATUSES).
    expect(tileValue(container, "Open")).toBe("3");
    // And the fallback must NEVER substitute the ORG total (12) for a personal count.
    // A stale number is recoverable; someone else's number is just wrong.
    expect(tileValue(container, "Open")).not.toBe("12");
  });

  it("does not present terminal actions as outstanding remediation", async () => {
    const mine = [
      anAction({ id: "m1", title: "Open item", owner_user_id: "user-1", status: "open" }),
      anAction({ id: "m4", title: "Closed item", owner_user_id: "user-1", status: "closed" }),
    ];
    api.getActions.mockResolvedValue(anActionsResponse(mine));

    await renderPage(ActionsPage, { searchParams: sp({ view: "mine" }) });

    // A closed action may be shown, but only under an explicitly terminal heading —
    // never inside an SLA/urgency bucket that implies work is outstanding.
    const resolved = screen.getByText("Resolved / closed");
    const section = resolved.closest("section")!;
    expect(section).toHaveTextContent("Closed item");
    expect(section).not.toHaveTextContent("Open item");
  });

  it("?active=true asks the engine for the ACTIVE set, not every status", async () => {
    await renderPage(ActionsPage, { searchParams: paramsOf(orgActionsHref({ active: true })) });

    const params = api.getActions.mock.calls[0][1];
    expect(params.active).toBe(true);
    expect(params.status).toBeUndefined();
  });

  it("a status-filtered tile lands on a list filtered the SAME way, and says so", async () => {
    await renderPage(ActionsPage, {
      searchParams: paramsOf(orgActionsHref({ status: "blocked" })),
    });

    // Both params were once silently dropped, so every dashboard tile landed on the
    // same unfiltered list and no tile's number could be reproduced.
    expect(api.getActions.mock.calls[0][1].status).toBe("blocked");
    expect(screen.getByText(/Filtered to status:/)).toBeInTheDocument();
    expect(screen.getByText("blocked")).toBeInTheDocument();
  });

  it("an overdue tile lands on the overdue list", async () => {
    await renderPage(ActionsPage, {
      searchParams: paramsOf(orgActionsHref({ overdue: true })),
    });

    expect(api.getActions.mock.calls[0][1].overdue).toBe(true);
  });
});

// ── 5. Authorization ─────────────────────────────────────────────────────────

describe("/actions — authorization", () => {
  it("sends a signed-out visitor to /login (flag off)", async () => {
    vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "false");
    signedOut();
    expect(await expectRedirect(ActionsPage, { searchParams: sp({}) })).toBe("/login");
  });

  it("sends a signed-out visitor to /login (flag on) — before any workspace redirect", async () => {
    vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "true");
    signedOut();
    expect(await expectRedirect(ActionsPage, { searchParams: sp({ view: "mine" }) })).toBe("/login");
    expect(api.getActions).not.toHaveBeenCalled();
  });

  it("sends an unentitled (non-platform) caller to /dashboard, not into the page", async () => {
    vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "true");
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "starter" }));

    expect(await expectRedirect(ActionsPage, { searchParams: sp({ view: "team" }) })).toBe(
      "/dashboard"
    );
    // And it must not have loaded the org's remediation data on the way out.
    expect(api.getActions).not.toHaveBeenCalled();
  });
});
