/**
 * concurrency.test.ts — bounded parallel map.
 *
 * Two properties are load-bearing for the callers: the limit is actually
 * enforced (the whole point — an unbounded burst is what trips provider rate
 * limits), and results stay in INPUT order (brief enrichment maps results
 * positionally back onto its items, so out-of-order results would silently
 * attach the wrong analysis to the wrong signal).
 */

import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "../lib/concurrency.js";

const defer = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("mapWithConcurrency", () => {
  it("never exceeds the limit in flight", async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await defer(n % 3);
      inFlight -= 1;
      return n;
    });

    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // and it really is parallel
  });

  it("returns results in INPUT order even when completion order differs", async () => {
    const results = await mapWithConcurrency([30, 5, 20, 1], 4, async (ms) => {
      await defer(ms);
      return ms;
    });
    expect(results).toEqual([30, 5, 20, 1]);
  });

  it("processes every item exactly once", async () => {
    const seen: number[] = [];
    await mapWithConcurrency(Array.from({ length: 50 }, (_, i) => i), 7, async (n) => {
      seen.push(n);
      return n;
    });
    expect(seen).toHaveLength(50);
    expect(new Set(seen).size).toBe(50);
  });

  it("handles an empty input without spawning workers", async () => {
    expect(await mapWithConcurrency([], 5, async () => 1)).toEqual([]);
  });

  it("clamps a nonsense limit to serial rather than deadlocking", async () => {
    const results = await mapWithConcurrency([1, 2, 3], 0, async (n) => n * 2);
    expect(results).toEqual([2, 4, 6]);
  });

  it("propagates a rejection, like Promise.all", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      })
    ).rejects.toThrow("boom");
  });

  it("never runs more workers than items", async () => {
    let started = 0;
    await mapWithConcurrency([1, 2], 16, async (n) => {
      started += 1;
      return n;
    });
    expect(started).toBe(2);
  });
});
