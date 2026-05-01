/**
 * fetchAllFeeds.test.ts — Aggregator tests with synthetic FeedAdapters.
 *
 * Covers the three orchestration guarantees fetchAllFeeds() must hold:
 *   1. Concatenates signals from every adapter in registration order.
 *   2. One adapter throwing does not abort the others; failures land in
 *      the per-feed `results` map under `error`.
 *   3. The optional `{ ids }` filter scopes the run to a subset of
 *      registered adapters; unknown ids are silently ignored.
 *
 * Tests use a vi.mock of registry.ts to substitute hand-built adapters
 * — no network, no XML parsing, no dependency on real-world feed shape.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FeedAdapter, CyberSignalIngestInput } from "../../lib/feedAdapter/types.js";

function makeFakeAdapter(
  id: string,
  emit: CyberSignalIngestInput[],
  opts?: { skipPerEmit?: number; throwOnFetch?: Error }
): FeedAdapter<CyberSignalIngestInput | null> {
  return {
    id,
    sourceTier: 1,
    signalType: "advisory",
    fetch: async () => {
      if (opts?.throwOnFetch) throw opts.throwOnFetch;
      // Each emit becomes one item; null items represent dropped/skipped items.
      const items: Array<CyberSignalIngestInput | null> = [...emit];
      if (opts?.skipPerEmit) {
        for (let i = 0; i < opts.skipPerEmit; i++) items.push(null);
      }
      return items;
    },
    toCyberSignal: (item) => item
  };
}

const fakeSignal = (source: string, n: number): CyberSignalIngestInput => ({
  source,
  signal_type: "advisory",
  severity: "Moderate",
  raw_payload: { n },
  normalized_summary: `signal-${source}-${n}`,
  affected_vendor: null,
  affected_cve: null
});

describe("fetchAllFeeds", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("aggregates signals from every registered adapter in registration order", async () => {
    vi.doMock("../../lib/feedAdapter/registry.js", () => ({
      FEEDS: [
        makeFakeAdapter("alpha", [fakeSignal("alpha", 1), fakeSignal("alpha", 2)]),
        makeFakeAdapter("beta", [fakeSignal("beta", 1)])
      ],
      THREAT_INTEL_FEED_IDS: new Set<string>(),
      REGULATORY_FEED_IDS: new Set<string>()
    }));

    const { fetchAllFeeds } = await import("../../lib/feedAdapter/index.js");
    const { signals, results } = await fetchAllFeeds();

    expect(signals.map((s) => s.source)).toEqual(["alpha", "alpha", "beta"]);
    expect(results.alpha).toEqual({ total: 2, mapped: 2, skipped: 0 });
    expect(results.beta).toEqual({ total: 1, mapped: 1, skipped: 0 });
  });

  it("counts skipped items (toCyberSignal returning null)", async () => {
    vi.doMock("../../lib/feedAdapter/registry.js", () => ({
      FEEDS: [
        makeFakeAdapter("alpha", [fakeSignal("alpha", 1)], { skipPerEmit: 2 })
      ],
      THREAT_INTEL_FEED_IDS: new Set<string>(),
      REGULATORY_FEED_IDS: new Set<string>()
    }));

    const { fetchAllFeeds } = await import("../../lib/feedAdapter/index.js");
    const { signals, results } = await fetchAllFeeds();

    expect(signals).toHaveLength(1);
    expect(results.alpha).toEqual({ total: 3, mapped: 1, skipped: 2 });
  });

  it("isolates per-adapter errors — one feed throwing does not abort the others", async () => {
    vi.doMock("../../lib/feedAdapter/registry.js", () => ({
      FEEDS: [
        makeFakeAdapter("alpha", [], { throwOnFetch: new Error("network down") }),
        makeFakeAdapter("beta", [fakeSignal("beta", 1), fakeSignal("beta", 2)]),
        makeFakeAdapter("gamma", [], { throwOnFetch: new Error("parse failed") })
      ],
      THREAT_INTEL_FEED_IDS: new Set<string>(),
      REGULATORY_FEED_IDS: new Set<string>()
    }));

    const { fetchAllFeeds } = await import("../../lib/feedAdapter/index.js");
    const { signals, results } = await fetchAllFeeds();

    // Beta still runs to completion despite alpha and gamma failing.
    expect(signals.map((s) => s.source)).toEqual(["beta", "beta"]);
    expect(results.alpha.error).toBe("network down");
    expect(results.alpha.mapped).toBe(0);
    expect(results.beta).toEqual({ total: 2, mapped: 2, skipped: 0 });
    expect(results.gamma.error).toBe("parse failed");
  });

  it("captures non-Error throws as their string form", async () => {
    vi.doMock("../../lib/feedAdapter/registry.js", () => ({
      FEEDS: [
        {
          id: "alpha",
          sourceTier: 1,
          signalType: "advisory",
          fetch: async () => {
            throw "plain string error";
          },
          toCyberSignal: () => null
        }
      ],
      THREAT_INTEL_FEED_IDS: new Set<string>(),
      REGULATORY_FEED_IDS: new Set<string>()
    }));

    const { fetchAllFeeds } = await import("../../lib/feedAdapter/index.js");
    const { results } = await fetchAllFeeds();

    expect(results.alpha.error).toBe("plain string error");
  });

  it("filter.ids scopes the run to the matching adapters", async () => {
    vi.doMock("../../lib/feedAdapter/registry.js", () => ({
      FEEDS: [
        makeFakeAdapter("alpha", [fakeSignal("alpha", 1)]),
        makeFakeAdapter("beta", [fakeSignal("beta", 1)]),
        makeFakeAdapter("gamma", [fakeSignal("gamma", 1)])
      ],
      THREAT_INTEL_FEED_IDS: new Set<string>(),
      REGULATORY_FEED_IDS: new Set<string>()
    }));

    const { fetchAllFeeds } = await import("../../lib/feedAdapter/index.js");
    const { signals, results } = await fetchAllFeeds({ ids: ["alpha", "gamma"] });

    expect(signals.map((s) => s.source)).toEqual(["alpha", "gamma"]);
    expect(Object.keys(results).sort()).toEqual(["alpha", "gamma"]);
    expect(results.beta).toBeUndefined();
  });

  it("filter.ids ignores unknown ids without erroring", async () => {
    vi.doMock("../../lib/feedAdapter/registry.js", () => ({
      FEEDS: [makeFakeAdapter("alpha", [fakeSignal("alpha", 1)])],
      THREAT_INTEL_FEED_IDS: new Set<string>(),
      REGULATORY_FEED_IDS: new Set<string>()
    }));

    const { fetchAllFeeds } = await import("../../lib/feedAdapter/index.js");
    const { signals, results } = await fetchAllFeeds({ ids: ["alpha", "no_such_feed"] });

    expect(signals).toHaveLength(1);
    expect(Object.keys(results)).toEqual(["alpha"]);
  });

  it("empty filter.ids array is treated as 'no filter' (matches legacy behavior)", async () => {
    vi.doMock("../../lib/feedAdapter/registry.js", () => ({
      FEEDS: [
        makeFakeAdapter("alpha", [fakeSignal("alpha", 1)]),
        makeFakeAdapter("beta", [fakeSignal("beta", 1)])
      ],
      THREAT_INTEL_FEED_IDS: new Set<string>(),
      REGULATORY_FEED_IDS: new Set<string>()
    }));

    const { fetchAllFeeds } = await import("../../lib/feedAdapter/index.js");
    const { signals } = await fetchAllFeeds({ ids: [] });

    expect(signals.map((s) => s.source)).toEqual(["alpha", "beta"]);
  });
});
