/**
 * entitlements.test.ts — locks the canonical platform predicate.
 *
 * These cases are deliberately exhaustive over every value that can reach
 * `me.entitlementLevel`, because the defect this helper exists to prevent was
 * a call site that silently handled only ONE of the three platform values
 * (`verify-email` tested `=== "premium"`). A predicate that is right for the
 * common value and wrong for the rare ones passes every happy-path test, so
 * the rare values are the point of this suite.
 */
import { describe, it, expect } from "vitest";

import { isPlatformEntitled, PLATFORM_ENTITLEMENT_LEVELS } from "../entitlements";

describe("isPlatformEntitled — the platform-entitled equivalence class", () => {
  it.each(["premium", "platform", "team"])(
    "admits %s (the engine collapses all three to rank 4)",
    (level) => {
      expect(isPlatformEntitled(level)).toBe(true);
    }
  );

  it.each(["starter", "professional", "standard"])(
    "denies %s",
    (level) => {
      expect(isPlatformEntitled(level)).toBe(false);
    }
  );

  it("denies Brief Pro (`professional`) — it is NOT in the triad", () => {
    // Guards a specific misreading: Brief Team maps to `professional` in
    // Stripe, and it is tempting to assume "Team" implies platform access.
    // Widening this would be a tier-policy decision, not a consistency fix.
    expect(isPlatformEntitled("professional")).toBe(false);
  });

  it("treats a missing level as starter, not as entitled", () => {
    expect(isPlatformEntitled(undefined)).toBe(false);
    expect(isPlatformEntitled(null)).toBe(false);
  });

  it("denies unknown / future values rather than failing open", () => {
    expect(isPlatformEntitled("enterprise")).toBe(false);
    expect(isPlatformEntitled("")).toBe(false);
    expect(isPlatformEntitled("PREMIUM")).toBe(false);
  });

  it("exports exactly the three platform levels", () => {
    expect([...PLATFORM_ENTITLEMENT_LEVELS]).toEqual(["premium", "platform", "team"]);
  });
});
