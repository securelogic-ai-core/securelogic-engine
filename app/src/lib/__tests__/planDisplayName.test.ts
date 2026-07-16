/**
 * planDisplayName — the single source of truth for the plan label.
 *
 * Regression for the July-15 walkthrough Step-0 defect: the seeded walkthrough
 * org (organizations.entitlement_level = 'platform', stripe_subscription_tier =
 * NULL) rendered "Plan: Free" while every platform gate (isPlatformUser) passed
 * and the full GRC dashboard rendered. The entitlement fallback switch mapped
 * only premium/professional/admin, so 'platform' and 'team' fell to "Free" —
 * a pure display defect (verdict (a): no entitlement leak).
 *
 * Contract pinned here: every entitlement level the app's platform gates accept
 * (premium | platform | team) must NEVER display as "Free".
 */
import { describe, it, expect } from "vitest";
import { planDisplayName } from "../api";

describe("planDisplayName — Stripe tier preferred", () => {
  it("maps each Stripe tier to its display name", () => {
    expect(planDisplayName("anything", "professional")).toBe("Brief Pro");
    expect(planDisplayName("anything", "teams")).toBe("Brief Team");
    expect(planDisplayName("anything", "platform")).toBe("Platform Professional");
    expect(planDisplayName("anything", "platform_annual")).toBe("Platform Annual");
    expect(planDisplayName("anything", "team")).toBe("Platform Professional");
  });
});

describe("planDisplayName — entitlement fallback (no Stripe tier)", () => {
  it("the seeded walkthrough shape: entitlement 'platform', NULL tier — must NOT be Free", () => {
    // The exact observed defect: seed sets entitlement_level='platform' and never
    // sets stripe_subscription_tier.
    expect(planDisplayName("platform", null)).toBe("Platform Professional");
    expect(planDisplayName("platform", undefined)).toBe("Platform Professional");
  });

  it("every platform-gated entitlement level displays as a platform plan", () => {
    // Mirrors dashboard/page.tsx isPlatformUser: premium | platform | team.
    for (const level of ["premium", "platform", "team"]) {
      expect(planDisplayName(level, null)).not.toBe("Free");
    }
    expect(planDisplayName("premium", null)).toBe("Platform Professional");
    expect(planDisplayName("team", null)).toBe("Platform Professional");
  });

  it("keeps the existing fallbacks unchanged", () => {
    expect(planDisplayName("professional", null)).toBe("Brief Pro");
    expect(planDisplayName("admin", null)).toBe("Enterprise");
    expect(planDisplayName("starter", null)).toBe("Free");
    expect(planDisplayName("default", null)).toBe("Free");
  });
});
