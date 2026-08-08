/**
 * whatsNew — content contract.
 *
 * The release notes are data, so they are testable as data. These pins exist
 * because the failure modes are silent: a banner key the engine rejects means
 * "Got it" 400s and the panel never goes away, and a duplicate item id means a
 * React key collision that only shows up in the rendered list.
 */
import { describe, it, expect } from "vitest";
import { WAVE_1_RELEASE, BANNER_KEY_PATTERN } from "@/lib/whatsNew";

describe("whatsNew — Wave 1 release content", () => {
  it("uses a banner key the engine's shape guard accepts", () => {
    // Mirrors /^[a-z0-9:_-]{1,64}$/i in src/api/routes/templates.ts. A key that
    // fails this makes dismissal permanently impossible for every user.
    expect(WAVE_1_RELEASE.bannerKey).toMatch(BANNER_KEY_PATTERN);
    expect(WAVE_1_RELEASE.bannerKey.length).toBeLessThanOrEqual(64);
  });

  it("has stable, unique item ids", () => {
    const ids = WAVE_1_RELEASE.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every item a title, a why, and a destination", () => {
    // "Why this changed" is the point of the panel — an item without one is a
    // feature announcement, which is what we were trying not to ship.
    for (const item of WAVE_1_RELEASE.items) {
      expect(item.title.trim()).not.toBe("");
      expect(item.why.trim()).not.toBe("");
      expect(item.hrefLabel.trim()).not.toBe("");
      expect(item.href.startsWith("/")).toBe(true);
    }
  });

  it("only links to destinations Wave 1 actually makes reachable", () => {
    // Scope guard: Wave 2 and Wave 3 surfaces, and the still-dark executive
    // dashboard, must not be advertised. Announcing an unreachable capability is
    // worse than announcing nothing.
    const waveOneReachable = new Set([
      "/dashboard",
      "/posture",
      "/evidence",
      "/approvals",
      "/vendor-assurance/queue",
      "/findings",
    ]);
    for (const item of WAVE_1_RELEASE.items) {
      expect(waveOneReachable.has(item.href)).toBe(true);
    }
  });

  it("does not advertise the executive dashboard, which stays dark", () => {
    const text = JSON.stringify(WAVE_1_RELEASE).toLowerCase();
    expect(text).not.toContain("/executive");
  });
});
