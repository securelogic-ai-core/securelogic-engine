/**
 * postureAvailability — the one definition of "does a posture score exist?".
 *
 * The defect this guards against is a surface that promotes something weaker
 * than a score (a snapshot date, a failed read) into "you have a score". The
 * agreement block at the bottom is the load-bearing part: it pins the checklist's
 * completion rule to the dashboard's render rule on the same inputs, so the two
 * cannot drift apart again the way they did.
 */
import { describe, it, expect } from "vitest";
import {
  postureScoreOf,
  getPostureAvailability,
  isPostureAvailable,
} from "../postureAvailability";
import { getOnboardingStepCompletion } from "@/app/getting-started/onboardingProgress";

const EMPTY_INVENTORY = {
  frameworks: 0,
  vendors: 0,
  controls: 0,
  control_assessments: 0,
};

describe("postureScoreOf", () => {
  it("returns the score when one exists", () => {
    expect(postureScoreOf({ overall_score: 67 })).toBe(67);
  });

  it("preserves 0 — a real, achievable score, not 'missing'", () => {
    expect(postureScoreOf({ overall_score: 0 })).toBe(0);
    expect(postureScoreOf({ overall_score: 0 })).not.toBeNull();
  });

  it("returns null for an unscored, missing or absent posture block", () => {
    expect(postureScoreOf({ overall_score: null })).toBeNull();
    expect(postureScoreOf(null)).toBeNull();
    expect(postureScoreOf(undefined)).toBeNull();
  });
});

describe("getPostureAvailability — the three states stay distinct", () => {
  it("available: a score exists", () => {
    expect(getPostureAvailability({ posture: { overall_score: 67 } })).toBe("available");
  });

  it("available: a zero score is still available, never 'pending'", () => {
    expect(getPostureAvailability({ posture: { overall_score: 0 } })).toBe("available");
  });

  it("pending: summary read succeeded but nothing is scored yet", () => {
    expect(getPostureAvailability({ posture: { overall_score: null } })).toBe("pending");
  });

  it("pending: an unscored snapshot is still pending — a date is not a score", () => {
    // The shape a brand-new org actually gets back from the engine.
    expect(
      getPostureAvailability({
        posture: { overall_score: null, snapshot_date: "2026-08-10" },
      } as { posture: { overall_score: number | null } }),
    ).toBe("pending");
  });

  it("unavailable: a failed engine read is NOT 'no posture yet'", () => {
    expect(getPostureAvailability(null)).toBe("unavailable");
    expect(getPostureAvailability(undefined)).toBe("unavailable");
  });

  it("never reports a missing score as available", () => {
    for (const s of [null, undefined, { posture: null }, { posture: { overall_score: null } }]) {
      expect(isPostureAvailable(s)).toBe(false);
    }
  });
});

describe("checklist and dashboard agree on every posture input", () => {
  // The dashboard's rule, quoted from TheBriefing's posture_score case:
  //   m.score === null  ->  "Insufficient data — no posture snapshot yet."
  const dashboardSaysNoScore = (posture: { overall_score: number | null }) =>
    postureScoreOf(posture) === null;

  const CASES: Array<{ overall_score: number | null; snapshot_date: string | null }> = [
    { overall_score: null, snapshot_date: null },
    { overall_score: null, snapshot_date: "2026-08-10" }, // the divergent state
    { overall_score: 0, snapshot_date: null },
    { overall_score: 0, snapshot_date: "2026-08-10" },
    { overall_score: 67, snapshot_date: "2026-08-10" },
    { overall_score: 100, snapshot_date: null },
  ];

  it.each(CASES)(
    "step 5 is complete iff the dashboard renders a score (%j)",
    (posture) => {
      const step5Complete = getOnboardingStepCompletion(EMPTY_INVENTORY, posture)[4];
      expect(step5Complete).toBe(!dashboardSaysNoScore(posture));
    },
  );

  it("specifically: the state that used to disagree now agrees", () => {
    const unscoredSnapshot = { overall_score: null, snapshot_date: "2026-08-10" };
    expect(dashboardSaysNoScore(unscoredSnapshot)).toBe(true); // dashboard: insufficient data
    expect(getOnboardingStepCompletion(EMPTY_INVENTORY, unscoredSnapshot)[4]).toBe(false);
  });
});
