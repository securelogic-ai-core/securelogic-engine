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

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getMe.mockResolvedValue(aMe({ entitlementLevel: "platform" }));
  api.getActions.mockResolvedValue(anActionsResponse([MINE, THEIRS, UNASSIGNED]));
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
});

// ── 3. Enterprise (org) vs user scope ────────────────────────────────────────

describe("/actions — user-scoped My Work vs org-scoped enterprise counts", () => {
  beforeEach(() => vi.stubEnv("SECURELOGIC_DECISION_WORKSPACE_ENABLED", "true"));

  it("?view=mine shows ONLY the caller's actions — never the org-wide population", async () => {
    await renderPage(ActionsPage, { searchParams: sp({ view: "mine" }) });

    expect(screen.getByText("Rotate the eu-west-1 backup keys")).toBeInTheDocument();
    // The engine returned the org's actions; a user-scoped view must not render them.
    expect(screen.queryByText("Someone else's vendor review")).not.toBeInTheDocument();
    expect(screen.queryByText("Unowned firewall rule cleanup")).not.toBeInTheDocument();
  });

  it("?view=mine never renders an ORG-WIDE count — no org summary is even fetched", async () => {
    api.getActionsSummary.mockResolvedValue(anActionsSummary({ open_count: 12 }));

    const { container } = await renderPage(ActionsPage, { searchParams: sp({ view: "mine" }) });

    // The org summary (12 active org-wide) must not reach a personal view: the caller
    // owns exactly ONE action, and "My Actions / Open: 12" would be a lie.
    expect(api.getActionsSummary).not.toHaveBeenCalled();
    expect(tileValue(container, "Open")).toBe("1");
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
    // And it must not borrow the org-wide summary to fill its numbers.
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

    const { container } = await renderPage(ActionsPage, { searchParams: sp({ view: "mine" }) });

    // active = open | in_progress | blocked → 3. Not 5 (terminal work is done) and
    // not 2 (blocked work is still work — the whole point of ACTION_ACTIVE_STATUSES).
    expect(tileValue(container, "Open")).toBe("3");
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
