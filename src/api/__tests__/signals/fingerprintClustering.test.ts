/**
 * fingerprintClustering.test.ts — Priority 4 / Phase 4C / C3b.
 *
 * The flag-gated CVE-less fingerprint corroboration pass in buildBriefItems.
 * Pins: flag-off byte-identity, fp: grouping, no double-merge with the CVE
 * merge, NULL→singleton, deterministic canonical, and corroboration counts on
 * both fp and CVE clusters when on.
 */

import { describe, it, expect } from "vitest";
import {
  buildBriefItems,
  type CyberSignalForBrief
} from "../../lib/intelligenceBriefGenerator.js";

let seq = 0;
function sig(part: Partial<CyberSignalForBrief>): CyberSignalForBrief {
  seq += 1;
  return {
    id: `id-${seq}`,
    signal_type: "patch_advisory",
    severity: "High",
    normalized_summary: `summary ${seq}`,
    affected_cve: null,
    affected_vendor: "Acme",
    source: "bleepingcomputer",
    ingestion_timestamp: "2026-06-28T00:00:00.000Z",
    ...part
  };
}

const bySlug = (items: Array<{ source_slug: string }>) => items.map((i) => i.source_slug).sort();

describe("fingerprint clustering — flag-off identity (C3b)", () => {
  it("clusteringEnabled=false is byte-identical to the default (pre-C3b) output", () => {
    const signals = [
      sig({ source: "bleepingcomputer", affected_vendor: "Acme", cluster_key: "fp:acme|patch_advisory|2026-06-28" }),
      sig({ source: "krebsonsecurity", affected_vendor: "Acme", cluster_key: "fp:acme|patch_advisory|2026-06-28" })
    ];
    const off = buildBriefItems(signals, undefined, false);
    const dflt = buildBriefItems(signals); // default arg
    expect(JSON.stringify(off)).toBe(JSON.stringify(dflt));
    // both fp items survive as separate singletons when off; no count field
    expect(off).toHaveLength(2);
    expect(JSON.stringify(off)).not.toContain("corroborating_source_count");
  });
});

describe("fingerprint clustering — flag-on grouping (C3b)", () => {
  it("collapses same fp: key into one canonical + corroboration", () => {
    seq = 0;
    const signals = [
      sig({ source: "bleepingcomputer", cluster_key: "fp:acme|patch_advisory|2026-06-28" }),
      sig({ source: "krebsonsecurity", cluster_key: "fp:acme|patch_advisory|2026-06-28" })
    ];
    const on = buildBriefItems(signals, undefined, true);
    expect(on).toHaveLength(1);
    expect(on[0].corroborating_sources).toHaveLength(1);
    expect(on[0].corroborating_source_count).toBe(1);
  });

  it("never merges across different fp: keys, and leaves NULL cluster_key as singletons", () => {
    seq = 0;
    const signals = [
      sig({ source: "bleepingcomputer", cluster_key: "fp:acme|patch_advisory|2026-06-28" }),
      sig({ source: "krebsonsecurity", affected_vendor: "Globex", cluster_key: "fp:globex|patch_advisory|2026-06-28" }),
      sig({ source: "sans_isc", affected_vendor: "Initech", cluster_key: null }) // unbackfilled ⇒ singleton
    ];
    const on = buildBriefItems(signals, undefined, true);
    expect(on).toHaveLength(3); // three distinct buckets, none merged
  });

  it("is deterministic — canonical honors priorityOf then recency then id", () => {
    seq = 0;
    const k = "fp:acme|patch_advisory|2026-06-28";
    const signals = [
      sig({ id: "z", source: "bleepingcomputer", cluster_key: k }),
      sig({ id: "a", source: "bleepingcomputer", cluster_key: k }) // same source+ts ⇒ id tie-break → 'a'
    ];
    const a = buildBriefItems(signals, undefined, true);
    const b = buildBriefItems(signals, undefined, true);
    expect(a[0].cyber_signal_id).toBe("a");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("fingerprint clustering — no double-merge with CVE (C3b)", () => {
  it("CVE items are merged by the CVE pass and untouched by the fp pass; counts on both", () => {
    seq = 0;
    const signals = [
      // CVE cluster (two sources, same CVE) — owned by mergeBriefItemsByCve
      sig({ source: "nvd", affected_cve: "CVE-2026-1234", affected_vendor: "OpenSSL", cluster_key: "cve:CVE-2026-1234" }),
      sig({ source: "bleepingcomputer", affected_cve: "CVE-2026-1234", affected_vendor: "OpenSSL", cluster_key: "cve:CVE-2026-1234" }),
      // fp cluster (two sources, no CVE) — owned by C3b
      sig({ source: "krebsonsecurity", affected_vendor: "Acme", cluster_key: "fp:acme|patch_advisory|2026-06-28" }),
      sig({ source: "sans_isc", affected_vendor: "Acme", cluster_key: "fp:acme|patch_advisory|2026-06-28" })
    ];
    const on = buildBriefItems(signals, undefined, true);
    expect(on).toHaveLength(2); // one CVE canonical + one fp canonical
    // both carry a corroboration count when the flag is on (fp from the pass,
    // CVE derived from the sources mergeBriefItemsByCve attached)
    for (const item of on) {
      expect(item.corroborating_source_count).toBe(1);
      expect(item.corroborating_sources).toHaveLength(1);
    }
  });
});
