/**
 * independentReviewSelection.test.ts — the pure reviewer-selection contract.
 *
 * chooseReviewer is the separation-of-duties heart of Independent Governance Review:
 * from an ordered list of eligible admins, pick one who is NOT the remediator, or null
 * when none qualifies. Null is a valid outcome (surface org-wide; never fabricate an
 * assignment, and never route the work to the very person barred from doing it).
 */

import { describe, it, expect } from "vitest";
import { chooseReviewer, type ReviewerCandidate } from "../independentReviewSelection.js";

const cands = (...ids: string[]): ReviewerCandidate[] => ids.map((id) => ({ id }));

describe("chooseReviewer", () => {
  it("picks the first admin who is not the remediator (deterministic order preserved)", () => {
    expect(chooseReviewer(cands("admin-1", "admin-2"), "remediator")).toBe("admin-1");
  });

  it("skips the remediator and returns the next eligible admin", () => {
    // The order is oldest-first from the query; the remediator being first must not
    // block assignment when another admin exists.
    expect(chooseReviewer(cands("remediator", "admin-2"), "remediator")).toBe("admin-2");
  });

  it("returns null when the ONLY admin is the remediator (SoD unsatisfiable)", () => {
    // The dead-action case this whole feature removes: never assign the work to the
    // person the close-time gate will refuse.
    expect(chooseReviewer(cands("remediator"), "remediator")).toBeNull();
  });

  it("returns null when there are no candidates at all", () => {
    expect(chooseReviewer([], "remediator")).toBeNull();
    expect(chooseReviewer([], null)).toBeNull();
  });

  it("when the remediator is unknown (null), any admin is eligible", () => {
    // A raw/scripted transition with no human actor: the first admin is a valid reviewer.
    expect(chooseReviewer(cands("admin-1", "admin-2"), null)).toBe("admin-1");
  });

  it("ignores blank ids without treating them as a match", () => {
    expect(chooseReviewer(cands("", "admin-2"), "remediator")).toBe("admin-2");
  });
});
