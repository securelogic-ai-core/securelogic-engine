/**
 * myActions.test.ts — pure logic for the minimal "My Actions" view (ERIP
 * Package 3.3, PR-5).
 *
 * The R5 user-isolation guard is no longer tested here: ownership filtering moved
 * OUT of the app (where it could only filter an already-capped page, silently
 * dropping a user's own work in a >100-action org) and INTO the engine as
 * `?owner=me`. Its security contract — literal "me" only, identity from the
 * session, API-key callers rejected rather than defaulted — is covered by
 * src/api/tests/findingListFilters.test.ts, the shared resolver both the Findings
 * and Actions lists call.
 */

import { describe, it, expect } from "vitest";
import {
  myActionsRedirect,
  isMyActionsView,
  actionScope,
  orgActionsHref,
  showingOfTotal,
} from "../myActions";

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

  it("an ACTIVE count links to an ACTIVE list — the number must be reproducible", () => {
    // The defect: the tile read "N active actions" (open|in_progress|blocked) but
    // its link carried no status filter at all, so the destination also listed
    // closed and accepted actions. No URL existed that could reproduce N. `active`
    // is the filter the Metric Contract's active set maps onto.
    expect(orgActionsHref({ active: true })).toBe("/actions?active=true&view=team");
  });

  it("active composes with a drill-down rather than replacing it", () => {
    expect(orgActionsHref({ active: true, overdue: true })).toBe(
      "/actions?overdue=true&active=true&view=team",
    );
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
