import { describe, it, expect } from "vitest";
import {
  getOnboardingStepCompletion,
  type OnboardingInventory,
  type OnboardingPosture,
} from "../onboardingProgress";

const EMPTY_INVENTORY: OnboardingInventory = {
  frameworks: 0,
  vendors: 0,
  controls: 0,
  control_assessments: 0,
};
const NO_POSTURE: OnboardingPosture = { overall_score: null, snapshot_date: null };

describe("getOnboardingStepCompletion", () => {
  it("marks nothing complete for a brand-new org", () => {
    expect(getOnboardingStepCompletion(EMPTY_INVENTORY, NO_POSTURE)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("marks each inventory step complete independently", () => {
    expect(
      getOnboardingStepCompletion(
        { frameworks: 1, vendors: 0, controls: 0, control_assessments: 0 },
        NO_POSTURE,
      ),
    ).toEqual([true, false, false, false, false]);
    expect(
      getOnboardingStepCompletion(
        { frameworks: 0, vendors: 2, controls: 3, control_assessments: 0 },
        NO_POSTURE,
      ),
    ).toEqual([false, true, true, false, false]);
  });

  it("can show '4 of 5' — assessment done but posture not yet available (the bug fix)", () => {
    const completion = getOnboardingStepCompletion(
      { frameworks: 1, vendors: 1, controls: 1, control_assessments: 1 },
      NO_POSTURE,
    );
    expect(completion).toEqual([true, true, true, true, false]);
    expect(completion.filter(Boolean).length).toBe(4); // previously impossible (jumped 3→5)
  });

  it("completes step 5 when posture has an overall_score", () => {
    const completion = getOnboardingStepCompletion(
      { frameworks: 1, vendors: 1, controls: 1, control_assessments: 1 },
      { overall_score: 72, snapshot_date: null },
    );
    expect(completion).toEqual([true, true, true, true, true]);
  });

  it("completes step 5 when only a snapshot_date is present (score still computing)", () => {
    expect(
      getOnboardingStepCompletion(EMPTY_INVENTORY, {
        overall_score: null,
        snapshot_date: "2026-06-30",
      })[4],
    ).toBe(true);
  });

  it("treats a zero posture score as available (0 is a real score, not 'missing')", () => {
    expect(
      getOnboardingStepCompletion(EMPTY_INVENTORY, {
        overall_score: 0,
        snapshot_date: null,
      })[4],
    ).toBe(true);
  });
});
