/**
 * postureTrend — the shared period-delta math behind /posture and the
 * Briefing score module (EG2 slice 12). The property under test: a delta is
 * only ever computed against an HONEST baseline (a snapshot actually near the
 * window edge) — "insufficient history" is null, never a fabricated 0%.
 */
import { describe, it, expect } from "vitest";
import { postureDelta, formatPostureDelta } from "../postureTrend";

const snap = (date: string, score: number | null) => ({
  snapshot_date: date,
  overall_score: score,
});

describe("postureDelta", () => {
  it("computes points and percent against the snapshot nearest the window edge", () => {
    const d = postureDelta(
      [snap("2026-06-30", 60), snap("2026-07-15", 64), snap("2026-07-30", 69)],
      30
    );
    expect(d).not.toBeNull();
    expect(d!.baselineDate).toBe("2026-06-30");
    expect(d!.points).toBe(9);
    expect(d!.pct).toBe(15);
  });

  it("declines a baseline outside the tolerance — a 90d delta needs a ~90d-old snapshot", () => {
    // Only 20 days of history: no honest 90-day story exists.
    expect(
      postureDelta([snap("2026-07-10", 60), snap("2026-07-30", 70)], 90)
    ).toBeNull();
  });

  it("accepts a baseline within ±25% of the window", () => {
    // 25 days old for a 30-day window (tolerance 7.5d) — acceptable.
    const d = postureDelta([snap("2026-07-05", 50), snap("2026-07-30", 55)], 30);
    expect(d).not.toBeNull();
    expect(d!.points).toBe(5);
  });

  it("null-score snapshots never become a baseline or a current value", () => {
    expect(postureDelta([snap("2026-06-30", null), snap("2026-07-30", 70)], 30)).toBeNull();
    expect(postureDelta([snap("2026-06-30", 60), snap("2026-07-30", null)], 30)).toBeNull();
  });

  it("declining posture reports negative points", () => {
    const d = postureDelta([snap("2026-06-30", 80), snap("2026-07-30", 72)], 30);
    expect(d!.points).toBe(-8);
    expect(d!.pct).toBe(-10);
  });
});

describe("formatPostureDelta", () => {
  it("renders sign, points and percent", () => {
    const up = postureDelta([snap("2026-06-30", 60), snap("2026-07-30", 69)], 30)!;
    expect(formatPostureDelta(up)).toBe("+9 (+15%)");
    const down = postureDelta([snap("2026-06-30", 80), snap("2026-07-30", 72)], 30)!;
    expect(formatPostureDelta(down)).toBe("−8 (−10%)");
  });
});
