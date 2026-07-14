/**
 * findingClosureError.test.ts — a customer must never see a raw error code.
 *
 * Every closure control in the product used to render the engine's `body.error` verbatim,
 * so a refused close put `close_requires_remediation_complete` on screen. (The Finding
 * detail card was worse: its form ignored the result entirely, so the button just silently
 * did nothing.) These pin the mapping that all four surfaces now share.
 */

import { describe, expect, it } from "vitest";

import {
  CLOSE_REQUIRES_REMEDIATION_COMPLETE,
  mapFindingActionError,
  remediationHref,
} from "../findingClosureError";

const FID = "11111111-2222-3333-4444-555555555555";

describe("mapFindingActionError", () => {
  it("turns the closure refusal into the approved customer-facing sentence", () => {
    const r = mapFindingActionError(
      { error: CLOSE_REQUIRES_REMEDIATION_COMPLETE, open_actions: 2 },
      FID
    );

    expect(r.error).toContain("Complete the remaining required remediation before closing this Finding.");
    // The count, because "finish the remediation" is not actionable on its own.
    expect(r.error).toContain("2 remediation items remain open");
    expect(r.blockingActions).toBe(2);
    // And a route to the work that is blocking them.
    expect(r.remediationHref).toBe(remediationHref(FID));
    expect(r.remediationHref).toContain("tab=remediation");

    // The raw code must not survive into anything a customer reads.
    expect(r.error).not.toContain("close_requires_remediation_complete");
    expect(r.error).not.toContain("_");
  });

  it("says 'item' and 'remains' for exactly one blocker", () => {
    const r = mapFindingActionError(
      { error: CLOSE_REQUIRES_REMEDIATION_COMPLETE, open_actions: 1 },
      FID
    );
    expect(r.error).toContain("1 remediation item remains open");
  });

  it("still gives the sentence and the link when the engine sends no count", () => {
    const r = mapFindingActionError({ error: CLOSE_REQUIRES_REMEDIATION_COMPLETE }, FID);

    expect(r.error).toContain("Complete the remaining required remediation");
    expect(r.blockingActions).toBeUndefined();
    expect(r.remediationHref).toBe(remediationHref(FID));
  });

  it("maps the governance axis's own refusal to the SAME words", () => {
    // A customer should not have to learn which of our two internal axes refused them.
    const r = mapFindingActionError({ error: "invalid_decision_transition" }, FID);

    expect(r.error).toContain("Complete the remaining required remediation before closing this Finding.");
    expect(r.remediationHref).toBe(remediationHref(FID));
  });

  it("humanizes any UNMAPPED code rather than leaking it as-is", () => {
    // Last line of defence. A code we forgot to map must still not reach a customer looking
    // like an identifier out of a database.
    const r = mapFindingActionError({ error: "some_unmapped_engine_code" }, FID);

    expect(r.error).toBe("Some unmapped engine code");
    expect(r.error).not.toContain("_");
  });

  it("passes a real sentence through untouched", () => {
    const r = mapFindingActionError({ error: "Not authenticated" }, FID);
    expect(r.error).toBe("Not authenticated");
  });

  it("falls back when there is no error at all", () => {
    expect(mapFindingActionError({}, FID).error).toBe("Failed to update finding");
    expect(mapFindingActionError({}, FID, "Failed to update status").error).toBe(
      "Failed to update status"
    );
  });
});
