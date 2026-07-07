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

  describe("step 2 is flag-aware (Asset Registry onboarding, EAR P12/P13)", () => {
    it("dark default: step 2 stays keyed to vendors (byte-for-byte legacy)", () => {
      // No options → identical to the legacy vendor behavior.
      expect(
        getOnboardingStepCompletion(
          { frameworks: 0, vendors: 1, controls: 0, control_assessments: 0 },
          NO_POSTURE,
        )[1],
      ).toBe(true);
      expect(getOnboardingStepCompletion(EMPTY_INVENTORY, NO_POSTURE, { assetRegistryEnabled: false })[1]).toBe(
        false,
      );
    });

    it("flag on: step 2 completes on registry assets, NOT vendors", () => {
      // Vendors present but no registry assets → step 2 incomplete when enabled.
      expect(
        getOnboardingStepCompletion(
          { frameworks: 0, vendors: 5, controls: 0, control_assessments: 0 },
          NO_POSTURE,
          { assetRegistryEnabled: true, assetsTotal: 0 },
        )[1],
      ).toBe(false);
      // ≥1 registry asset (even with zero vendors) → complete.
      expect(
        getOnboardingStepCompletion(EMPTY_INVENTORY, NO_POSTURE, {
          assetRegistryEnabled: true,
          assetsTotal: 1,
        })[1],
      ).toBe(true);
    });

    it("flag on but no assetsTotal provided → treated as 0 (incomplete)", () => {
      expect(
        getOnboardingStepCompletion(EMPTY_INVENTORY, NO_POSTURE, { assetRegistryEnabled: true })[1],
      ).toBe(false);
    });
  });
});
