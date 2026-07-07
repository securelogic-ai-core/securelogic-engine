/**
 * eventSignalResolver.test.ts — Intelligence Pipeline Hardening (event-native linkage).
 *
 * Pins the ingestion-record → authoritative-model resolver: primary via the
 * corroboration ledger (cyber_signal_id → event_id), CVE-primary canonical-key
 * fallback, null when neither resolves, and batch resolution.
 */

import { describe, it, expect, vi } from "vitest";
import { resolveEventIdForSignal, resolveEventIdsForSignals } from "../../lib/signals/eventSignalResolver.js";

/** Scripted fake: dispatches by SQL substring. */
function client(handlers: { sources?: Record<string, string>; byKey?: Record<string, string>; batch?: Record<string, string> }) {
  return {
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<{ rows: T[] }> {
      const rows = (r: unknown[]) => ({ rows: r as T[] });
      if (text.includes("FROM intelligence_event_sources") && text.includes("cyber_signal_id = $1")) {
        const ev = handlers.sources?.[params[0] as string];
        return rows(ev ? [{ event_id: ev }] : []);
      }
      if (text.includes("FROM intelligence_events WHERE canonical_key")) {
        const ev = handlers.byKey?.[params[0] as string];
        return rows(ev ? [{ id: ev }] : []);
      }
      if (text.includes("cyber_signal_id = ANY($1)")) {
        const ids = params[0] as string[];
        return rows(ids.filter((i) => handlers.batch?.[i]).map((i) => ({ cyber_signal_id: i, event_id: handlers.batch![i] })));
      }
      throw new Error("unhandled: " + text.slice(0, 60));
    }
  };
}

describe("resolveEventIdForSignal", () => {
  it("resolves via the corroboration ledger first", async () => {
    const c = client({ sources: { "sig-1": "evt-1" } });
    expect(await resolveEventIdForSignal(c, "sig-1", "CVE-2026-1234")).toBe("evt-1");
  });

  it("falls back to the CVE canonical key when the signal is not a recorded source", async () => {
    const c = client({ sources: {}, byKey: { "cve:CVE-2026-1234": "evt-9" } });
    expect(await resolveEventIdForSignal(c, "sig-x", "cve-2026-1234")).toBe("evt-9");
  });

  it("returns null when neither resolves (and ignores malformed CVEs)", async () => {
    const c = client({ sources: {}, byKey: {} });
    expect(await resolveEventIdForSignal(c, "sig-x", "CVE-2026-1")).toBeNull(); // too-short CVE → no key query match
    expect(await resolveEventIdForSignal(c, "sig-y", null)).toBeNull();
  });
});

describe("resolveEventIdsForSignals", () => {
  it("batch-resolves via the ledger", async () => {
    const c = client({ batch: { "s1": "e1", "s3": "e3" } });
    const map = await resolveEventIdsForSignals(c, ["s1", "s2", "s3"]);
    expect(map.get("s1")).toBe("e1");
    expect(map.has("s2")).toBe(false);
    expect(map.get("s3")).toBe("e3");
  });

  it("empty input → empty map (no query)", async () => {
    const spy = { query: vi.fn() };
    expect((await resolveEventIdsForSignals(spy, [])).size).toBe(0);
    expect(spy.query).not.toHaveBeenCalled();
  });
});
