/**
 * Eligibility-resolution tests (Briefing Initiative B1).
 *
 * The invariants that make personalization safe later:
 *   - permissions override personalization (requested ⊆ eligible, always);
 *   - personal modules are ABSENT (not zeroed) without a user identity;
 *   - flag-gated modules resolve away fail-closed;
 *   - non-platform sessions resolve platform modules away even though the
 *     summary data sits in the page props for every tier.
 */
import { describe, it, expect } from "vitest";
import { BRIEFING_MODULE_IDS } from "../contracts";
import {
  resolveEligibleModules,
  filterRequestedModules,
  type BriefingEligibility,
} from "../resolveBriefing";

const PLATFORM_JWT: BriefingEligibility = {
  isPlatformUser: true,
  hasUserIdentity: true,
  flags: { independent_review: true },
};

describe("resolveEligibleModules", () => {
  it("platform JWT session with all flags on gets the full registry", () => {
    const ids = resolveEligibleModules(PLATFORM_JWT).map((m) => m.id);
    expect([...ids].sort()).toEqual([...BRIEFING_MODULE_IDS].sort());
  });

  it("a non-platform session resolves every platform module away", () => {
    const ids = resolveEligibleModules({
      ...PLATFORM_JWT,
      isPlatformUser: false,
    }).map((m) => m.id);
    // Only the all-tier module survives.
    expect(ids).toEqual(["latest_brief"]);
  });

  it("an API-key session (no user identity) has NO personal modules — absent, not empty", () => {
    const mods = resolveEligibleModules({ ...PLATFORM_JWT, hasUserIdentity: false });
    expect(mods.some((m) => m.scope === "personal")).toBe(false);
    // Organization modules are unaffected.
    expect(mods.some((m) => m.id === "needs_attention")).toBe(true);
  });

  it("independent_review flag off resolves My Pending Reviews away (fail-closed)", () => {
    const off = resolveEligibleModules({ ...PLATFORM_JWT, flags: {} });
    expect(off.some((m) => m.id === "my_pending_reviews")).toBe(false);
    const explicitOff = resolveEligibleModules({
      ...PLATFORM_JWT,
      flags: { independent_review: false },
    });
    expect(explicitOff.some((m) => m.id === "my_pending_reviews")).toBe(false);
  });

  it("modules come back in canonical zone order (your_work → organization → intelligence)", () => {
    const zones = resolveEligibleModules(PLATFORM_JWT).map((m) => m.zone);
    const firstOrg = zones.indexOf("organization");
    const firstIntel = zones.indexOf("intelligence");
    expect(zones.lastIndexOf("your_work")).toBeLessThan(firstOrg);
    expect(zones.lastIndexOf("organization")).toBeLessThan(firstIntel);
  });
});

describe("filterRequestedModules — a stored layout never grants access", () => {
  it("requested ⊆ eligible for EVERY session shape (property)", () => {
    const everyId = [...BRIEFING_MODULE_IDS, "made_up_module", "posture_score"];
    const contexts: BriefingEligibility[] = [
      PLATFORM_JWT,
      { ...PLATFORM_JWT, isPlatformUser: false },
      { ...PLATFORM_JWT, hasUserIdentity: false },
      { ...PLATFORM_JWT, flags: {} },
      { isPlatformUser: false, hasUserIdentity: false, flags: {} },
    ];
    for (const ctx of contexts) {
      const eligible = new Set(resolveEligibleModules(ctx).map((m) => m.id));
      const granted = filterRequestedModules(everyId, ctx);
      for (const m of granted) {
        expect(eligible.has(m.id)).toBe(true);
      }
    }
  });

  it("preserves requested order, drops unknowns and duplicates", () => {
    const granted = filterRequestedModules(
      ["latest_brief", "bogus", "my_work", "latest_brief", "needs_attention"],
      PLATFORM_JWT,
    );
    expect(granted.map((m) => m.id)).toEqual([
      "latest_brief",
      "my_work",
      "needs_attention",
    ]);
  });

  it("an ineligible request drops out silently — permissions override personalization", () => {
    const granted = filterRequestedModules(["my_work", "latest_brief"], {
      ...PLATFORM_JWT,
      hasUserIdentity: false,
    });
    expect(granted.map((m) => m.id)).toEqual(["latest_brief"]);
  });
});
