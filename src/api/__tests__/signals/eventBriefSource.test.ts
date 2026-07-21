/**
 * eventBriefSource.test.ts — Intelligence Pipeline Hardening (item 1).
 *
 * Proves the Intelligence Brief consumes canonical events: event rows map to the
 * CyberSignalForBrief shape the pure generator already uses, carry the NORMALIZED
 * (display-safe, cited) executive summary as their content (never raw feed text /
 * broken sentences), and flow through generateBrief() into brief items.
 */

import { describe, it, expect } from "vitest";
import { fetchBriefEventRows } from "../../lib/signals/eventBriefSource.js";
import { generateBrief } from "../../lib/intelligenceBriefGenerator.js";

interface Row { [k: string]: unknown }

/** Fake client returning canned intelligence_events rows. */
function fakeClient(rows: Row[]) {
  return {
    async query<T = Record<string, unknown>>() {
      return { rows: rows as unknown as T[] };
    }
  };
}

const eventRows: Row[] = [
  {
    id: "evt-1", event_type: "cve", severity: "Critical", title: "Acme Gateway RCE",
    executive_summary: "Acme Gateway has a critical RCE. Active exploitation has been reported. Sources: NVD, CISA KEV.",
    affected_cve: "CVE-2026-4242", affected_vendor: "Acme",
    canonical_key: "cve:CVE-2026-4242", last_seen_at: new Date("2026-07-07T10:00:00.000Z"),
    canonical_source: "nvd"
  },
  {
    id: "evt-2", event_type: "breach", severity: "High", title: "Beta breach disclosed",
    executive_summary: "Beta disclosed a data breach affecting customer records. Sources: BleepingComputer.",
    affected_cve: null, affected_vendor: "Beta",
    canonical_key: "fp:beta|breach|2026-07-06", last_seen_at: "2026-07-06T09:00:00.000Z",
    canonical_source: "bleepingcomputer"
  }
];

describe("fetchBriefEventRows", () => {
  it("maps events to brief source rows carrying the normalized summary + canonical key", async () => {
    const rows = await fetchBriefEventRows(fakeClient(eventRows), "2026-07-01", "2026-07-08");
    expect(rows).toHaveLength(2);
    const r = rows[0];
    expect(r.id).toBe("evt-1");
    expect(r.signal_type).toBe("cve");
    expect(r.normalized_summary).toBe(eventRows[0].executive_summary); // normalized, not raw
    expect(r.cluster_key).toBe("cve:CVE-2026-4242");
    expect(r.source).toBe("nvd");
    expect(r.ingestion_timestamp).toBe("2026-07-07T10:00:00.000Z");
  });

  it("feeds generateBrief so the Brief is built from events (no broken sentences)", async () => {
    const rows = await fetchBriefEventRows(fakeClient(eventRows), "2026-07-01", "2026-07-08");
    const base = generateBrief(rows, { priorityOf: () => 1, clusteringEnabled: false });
    expect(base.shortlist.length).toBeGreaterThan(0);
    // Every brief item traces to an event id and shows a complete summary.
    for (const item of base.shortlist) {
      expect(["evt-1", "evt-2"]).toContain(item.cyber_signal_id);
      const text = JSON.stringify(item);
      expect(text).not.toContain("undefined");
      // no mechanical mid-sentence ellipsis from raw feed text
      expect(text.includes("...")).toBe(false);
    }
  });
});
