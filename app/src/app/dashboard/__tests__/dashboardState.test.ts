/**
 * dashboardState.test.ts — the dashboard must distinguish a FAILED summary load
 * from an empty-by-design org (workflow-consistency Phase 2). A failed fetch
 * (summaryLoaded=false) renders an explicit error; a loaded summary — even all
 * zeros — renders the real panel.
 */

import { describe, it, expect } from "vitest";
import { dashboardPanel, pendingReviewTile } from "../dashboardState";

describe("dashboardPanel", () => {
  it("shows the sample dashboard to non-platform users regardless of load state", () => {
    expect(dashboardPanel(false, true)).toBe("sample");
    expect(dashboardPanel(false, false)).toBe("sample");
  });

  it("shows the real posture panel when the summary loaded (zeros are a real empty state)", () => {
    expect(dashboardPanel(true, true)).toBe("posture");
  });

  it("shows an EXPLICIT error — never a silent drop — when the summary failed to load", () => {
    expect(dashboardPanel(true, false)).toBe("error");
  });
});

// ── pendingReviewTile — count-scope contract (2026-07-20) ──────────────────────
// One predicate, two scopes: org-wide ready-for-decision vs the viewer's own
// review queue (review_owner=me). The tile must NEVER show the org-wide number
// under a personal-sounding label; these tests pin the scope selection.
describe("pendingReviewTile", () => {
  it("a reviewer with assigned reviews leads with THEIR count and links THEIR queue", () => {
    expect(pendingReviewTile(5, 1, true)).toEqual({
      variant: "personal",
      mine: 1,
      orgWide: 5,
      href: "/findings?bucket=pending_independent_review",
    });
  });

  it("no assigned reviews → the org-wide leadership tile, linked to the org-wide queue", () => {
    expect(pendingReviewTile(5, 0, true)).toEqual({
      variant: "org",
      orgWide: 5,
      href: "/findings?bucket=ready_to_close",
    });
  });

  it("unknown personal count (API-key session / failed fetch) is NOT treated as zero-or-personal — org variant", () => {
    expect(pendingReviewTile(5, null, true)).toEqual({
      variant: "org",
      orgWide: 5,
      href: "/findings?bucket=ready_to_close",
    });
  });

  it("independent-review flag OFF → never the personal variant (its queue does not exist), even with a personal count", () => {
    expect(pendingReviewTile(5, 1, false)).toEqual({
      variant: "org",
      orgWide: 5,
      href: "/findings?bucket=ready_to_close",
    });
  });

  it("nothing to surface → null (tile hidden, unchanged gate)", () => {
    expect(pendingReviewTile(0, 0, true)).toBeNull();
    expect(pendingReviewTile(0, null, false)).toBeNull();
  });

  it("personal variant still carries the org-wide total so the tile can label it as context", () => {
    const tile = pendingReviewTile(7, 3, true);
    expect(tile?.variant).toBe("personal");
    expect((tile as { orgWide: number }).orgWide).toBe(7);
  });
});
