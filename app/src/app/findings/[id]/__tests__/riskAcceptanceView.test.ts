/**
 * riskAcceptanceView — the PURE risk-acceptance state machine, proven without a browser.
 *
 * These are the invariants the panel's honesty rests on: a proposal is never described as
 * a closure, separation of duties refuses the proposer BEFORE any round-trip, and a
 * guarded engine refusal is turned into a sentence, never swallowed.
 */
import { describe, it, expect } from "vitest";
import { aRiskAcceptance } from "@/test/fixtures";
import {
  partitionAcceptances,
  acceptanceNarrative,
  canDecide,
  isReviewDueSoon,
  riskAcceptanceErrorCopy,
} from "../riskAcceptanceView";

describe("partitionAcceptances", () => {
  it("puts the single live record in `live` and terminal records in history, newest-first", () => {
    const proposed = aRiskAcceptance({ id: "live", state: "proposed", updated_at: "2026-07-10T00:00:00Z" });
    const rejected = aRiskAcceptance({ id: "old", state: "rejected", updated_at: "2026-07-01T00:00:00Z" });
    const withdrawn = aRiskAcceptance({ id: "mid", state: "withdrawn", updated_at: "2026-07-05T00:00:00Z" });

    const { live, history } = partitionAcceptances([rejected, proposed, withdrawn]);

    expect(live?.id).toBe("live");
    expect(history.map((h) => h.id)).toEqual(["mid", "old"]); // newest terminal first
  });

  it("treats approved and legacy_unverified as live; a finding with none has null live", () => {
    expect(partitionAcceptances([aRiskAcceptance({ state: "approved" })]).live?.state).toBe("approved");
    expect(partitionAcceptances([aRiskAcceptance({ state: "legacy_unverified", governance_review_required: true })]).live?.state).toBe(
      "legacy_unverified"
    );
    expect(partitionAcceptances([aRiskAcceptance({ state: "expired" })]).live).toBeNull();
    expect(partitionAcceptances([]).live).toBeNull();
  });
});

describe("acceptanceNarrative — a proposal is never a closure", () => {
  it("proposed says the finding STAYS ACTIVE and is not yet approved", () => {
    const n = acceptanceNarrative(aRiskAcceptance({ state: "proposed" }));
    expect(n.tone).toBe("pending");
    expect(n.what).toMatch(/stays Active/i);
    expect(n.what).not.toMatch(/closed/i);
  });

  it("approved is the ONLY state that says the finding is closed", () => {
    const n = acceptanceNarrative(aRiskAcceptance({ state: "approved" }));
    expect(n.tone).toBe("binding");
    expect(n.what).toMatch(/closed/i);
    expect(n.what).toMatch(/governed/i);
  });

  it("withdrawn and expired both say the finding was REOPENED", () => {
    expect(acceptanceNarrative(aRiskAcceptance({ state: "withdrawn" })).what).toMatch(/reopened/i);
    expect(acceptanceNarrative(aRiskAcceptance({ state: "expired" })).what).toMatch(/reopened/i);
  });

  it("rejected says the finding was never closed and remains Active", () => {
    const n = acceptanceNarrative(aRiskAcceptance({ state: "rejected" }));
    expect(n.tone).toBe("declined");
    expect(n.what).toMatch(/never closed|remains Active/i);
  });
});

describe("canDecide — separation of duties, client side", () => {
  const live = aRiskAcceptance({ requested_by_user_id: "user-1" });

  it("refuses the proposer", () => {
    expect(canDecide(live, "user-1")).toBe(false);
  });
  it("allows a different authorized user", () => {
    expect(canDecide(live, "user-2")).toBe(true);
  });
  it("refuses an API-key caller with no user identity", () => {
    expect(canDecide(live, null)).toBe(false);
  });
});

describe("isReviewDueSoon", () => {
  const today = new Date("2026-12-01T00:00:00Z");

  it("is true for an approved acceptance inside the 30-day horizon", () => {
    expect(isReviewDueSoon(aRiskAcceptance({ state: "approved", expires_at: "2026-12-15" }), today)).toBe(true);
  });
  it("is false when the review date is beyond the horizon", () => {
    expect(isReviewDueSoon(aRiskAcceptance({ state: "approved", expires_at: "2027-06-01" }), today)).toBe(false);
  });
  it("is false for a non-approved acceptance regardless of date", () => {
    expect(isReviewDueSoon(aRiskAcceptance({ state: "proposed", expires_at: "2026-12-15" }), today)).toBe(false);
  });
});

describe("riskAcceptanceErrorCopy — nothing is swallowed", () => {
  it("maps separation of duties to a sentence a person can act on", () => {
    expect(riskAcceptanceErrorCopy("separation_of_duties")).toMatch(/different authorized user/i);
  });
  it("explains the legacy completion path", () => {
    expect(riskAcceptanceErrorCopy("legacy_acceptance_requires_completion")).toMatch(/withdraw/i);
  });
  it("passes an unmapped code through rather than hiding it", () => {
    expect(riskAcceptanceErrorCopy("some_new_engine_code")).toBe("some_new_engine_code");
  });
  it("has a generic fallback for a missing code", () => {
    expect(riskAcceptanceErrorCopy(undefined)).toMatch(/went wrong/i);
  });
});
