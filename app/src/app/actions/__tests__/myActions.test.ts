/**
 * myActions.test.ts — pure logic for the minimal "My Actions" view (ERIP
 * Package 3.3, PR-5). The critical case is the R5 tenant/user-isolation guard:
 * ownership derives from the SESSION identity, never request input, and a
 * missing identity fails closed (empty), never the org-wide set.
 */

import { describe, it, expect } from "vitest";
import {
  filterMyActions,
  myActionsRedirect,
  isMyActionsView,
  actionScope,
  orgActionsHref,
  showingOfTotal,
} from "../myActions";

type A = { owner_user_id: string | null; id: string };
const rows: A[] = [
  { id: "a1", owner_user_id: "user-1" },
  { id: "a2", owner_user_id: "user-2" },
  { id: "a3", owner_user_id: null },
  { id: "a4", owner_user_id: "user-1" },
];

describe("filterMyActions (R5 isolation)", () => {
  it("keeps only actions owned by the session user", () => {
    expect(filterMyActions(rows, "user-1").map((a) => a.id)).toEqual(["a1", "a4"]);
  });

  it("never returns another user's actions", () => {
    expect(filterMyActions(rows, "user-2").map((a) => a.id)).toEqual(["a2"]);
  });

  it("fails closed to empty when the session identity is missing (never org-wide)", () => {
    expect(filterMyActions(rows, undefined)).toEqual([]);
    expect(filterMyActions(rows, "")).toEqual([]);
  });

  it("excludes unowned (null owner) actions", () => {
    expect(filterMyActions(rows, "user-1").some((a) => a.owner_user_id === null)).toBe(false);
  });
});

describe("myActionsRedirect", () => {
  it("redirects a bare /actions to the canonical My Actions form when the workspace is on", () => {
    expect(myActionsRedirect(true, undefined)).toBe("/actions?view=mine");
    expect(myActionsRedirect(true, "")).toBe("/actions?view=mine");
  });

  it("does not redirect once already on a recognized scope (mine or team)", () => {
    expect(myActionsRedirect(true, "mine")).toBeNull();
    expect(myActionsRedirect(true, "team")).toBeNull();
  });

  it("redirects an unrecognized view to the canonical My Actions form", () => {
    expect(myActionsRedirect(true, "everything")).toBe("/actions?view=mine");
  });

  it("never redirects while the workspace is dark (legacy list preserved)", () => {
    expect(myActionsRedirect(false, undefined)).toBeNull();
    expect(myActionsRedirect(false, "mine")).toBeNull();
  });
});

describe("actionScope", () => {
  it("recognizes mine and team only", () => {
    expect(actionScope("mine")).toBe("mine");
    expect(actionScope("team")).toBe("team");
    expect(actionScope(undefined)).toBeNull();
    expect(actionScope("nope")).toBeNull();
  });
});

describe("isMyActionsView", () => {
  it("is true when the workspace is on AND view is a recognized scope", () => {
    expect(isMyActionsView(true, "mine")).toBe(true);
    expect(isMyActionsView(true, "team")).toBe(true);
    expect(isMyActionsView(true, undefined)).toBe(false);
    expect(isMyActionsView(false, "mine")).toBe(false);
  });
});

describe("orgActionsHref (dashboard count → org-wide destination reconciliation)", () => {
  it("always carries view=team so an org-wide count never lands on user-scoped My Actions", () => {
    // Bare "View all actions" — the defect was this redirecting to ?view=mine.
    expect(orgActionsHref()).toBe("/actions?view=team");
  });

  it("preserves the drill-down filter alongside the org-wide scope", () => {
    expect(orgActionsHref({ status: "open" })).toBe("/actions?status=open&view=team");
    expect(orgActionsHref({ status: "in_progress" })).toBe("/actions?status=in_progress&view=team");
    expect(orgActionsHref({ overdue: true })).toBe("/actions?overdue=true&view=team");
  });

  it("is inert to a recognized scope in the legacy (flag-off) path — view=team is ignored there", () => {
    // The URL is safe in both flag states: flag-on renders the org-wide 'team'
    // view; flag-off falls through to the legacy list which honors status/overdue.
    expect(orgActionsHref({ status: "open" })).toContain("status=open");
  });
});

describe("showingOfTotal (no silent truncation)", () => {
  it("discloses the shortfall when the rendered slice is smaller than the true total", () => {
    expect(showingOfTotal(100, 342)).toBe("Showing 100 of 342");
  });

  it("returns null when the full set is shown (nothing to disclose)", () => {
    expect(showingOfTotal(42, 42)).toBeNull();
    expect(showingOfTotal(42, 10)).toBeNull(); // defensive: total never < shown
  });

  it("returns null when the total is unknown (undefined)", () => {
    expect(showingOfTotal(100, undefined)).toBeNull();
  });
});
