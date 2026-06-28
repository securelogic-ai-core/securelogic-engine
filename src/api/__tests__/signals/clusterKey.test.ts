/**
 * clusterKey.test.ts — Priority 4 / Phase 4C / C1.
 *
 * The cluster key is a SOFT corroboration grouping that lives beside (never
 * touches) dedup_hash. These tests pin its contract: same-CVE clusters, distinct
 * events don't, CVE-less fingerprint by vendor+type+UTC-day, degenerate → null,
 * deterministic, UTC-bucketed.
 */

import { describe, it, expect } from "vitest";
import {
  clusterKey,
  CLUSTER_KEY_CVE_PREFIX,
  CLUSTER_KEY_FP_PREFIX,
  type ClusterKeyInput
} from "../../lib/signals/clusterKey.js";

function sig(part: Partial<ClusterKeyInput>): ClusterKeyInput {
  return {
    affected_cve: null,
    affected_vendor: null,
    signal_type: "cve",
    ingestion_timestamp: "2026-06-28T12:00:00.000Z",
    ...part
  };
}

describe("clusterKey — CVE-primary (C1)", () => {
  it("clusters the same CVE across different sources/vendors into one key", () => {
    const fromKev = sig({ affected_cve: "CVE-2026-1234", affected_vendor: "OpenSSL" });
    const fromNvd = sig({ affected_cve: "CVE-2026-1234", affected_vendor: null });
    const fromNews = sig({ affected_cve: "CVE-2026-1234", affected_vendor: "SomeBlog" });
    expect(clusterKey(fromKev)).toBe("cve:CVE-2026-1234");
    expect(clusterKey(fromNvd)).toBe(clusterKey(fromKev));
    expect(clusterKey(fromNews)).toBe(clusterKey(fromKev));
  });

  it("keeps distinct CVEs in distinct clusters", () => {
    expect(clusterKey(sig({ affected_cve: "CVE-2026-1234" }))).not.toBe(
      clusterKey(sig({ affected_cve: "CVE-2026-9999" }))
    );
  });

  it("normalizes CVE case and whitespace to one key", () => {
    expect(clusterKey(sig({ affected_cve: "  cve-2026-1234 " }))).toBe("cve:CVE-2026-1234");
  });

  it("is CVE-primary — same CVE, different vendor still clusters (vendor ignored)", () => {
    const a = sig({ affected_cve: "CVE-2026-1234", affected_vendor: "VendorA" });
    const b = sig({ affected_cve: "CVE-2026-1234", affected_vendor: "VendorB" });
    expect(clusterKey(a)).toBe(clusterKey(b));
    expect(clusterKey(a)!.startsWith(CLUSTER_KEY_CVE_PREFIX)).toBe(true);
  });

  it("routes a malformed CVE to the CVE-less path (does not cluster on garbage)", () => {
    for (const bad of ["", "N/A", "CVE-x", "2026-1234", "CVE-26-1"]) {
      const k = clusterKey(sig({ affected_cve: bad, affected_vendor: "OpenSSL" }));
      expect(k).toBe("fp:openssl|cve|2026-06-28"); // fell through to fingerprint
    }
  });
});

describe("clusterKey — CVE-less fingerprint (C1)", () => {
  it("clusters same vendor + signal_type + UTC day", () => {
    const morning = sig({ affected_vendor: "Acme", signal_type: "patch_advisory", ingestion_timestamp: "2026-06-28T02:00:00Z" });
    const evening = sig({ affected_vendor: "acme", signal_type: "patch_advisory", ingestion_timestamp: "2026-06-28T23:00:00Z" });
    expect(clusterKey(morning)).toBe("fp:acme|patch_advisory|2026-06-28");
    expect(clusterKey(evening)).toBe(clusterKey(morning)); // vendor case-insensitive
  });

  it("separates different day, vendor, or signal_type", () => {
    const base = sig({ affected_vendor: "Acme", signal_type: "patch_advisory" });
    expect(clusterKey(sig({ ...base, ingestion_timestamp: "2026-06-29T00:00:00Z" }))).not.toBe(clusterKey(base));
    expect(clusterKey(sig({ ...base, affected_vendor: "Globex" }))).not.toBe(clusterKey(base));
    expect(clusterKey(sig({ ...base, signal_type: "regulatory_change" }))).not.toBe(clusterKey(base));
  });

  it("buckets by UTC day across a local-midnight boundary", () => {
    // 2026-06-28T23:30Z and 2026-06-29T00:30Z are ~1h apart but different UTC days
    const a = sig({ affected_vendor: "Acme", ingestion_timestamp: "2026-06-28T23:30:00Z" });
    const b = sig({ affected_vendor: "Acme", ingestion_timestamp: "2026-06-29T00:30:00Z" });
    expect(clusterKey(a)).toContain("2026-06-28");
    expect(clusterKey(b)).toContain("2026-06-29");
    expect(clusterKey(a)).not.toBe(clusterKey(b));
  });

  it("accepts a Date as well as an ISO string", () => {
    expect(clusterKey(sig({ affected_vendor: "Acme", ingestion_timestamp: new Date("2026-06-28T10:00:00Z") }))).toBe(
      "fp:acme|cve|2026-06-28"
    );
  });
});

describe("clusterKey — degenerate + invariants (C1)", () => {
  it("returns null when there is no valid CVE and no vendor (no over-merge)", () => {
    expect(clusterKey(sig({ affected_cve: null, affected_vendor: null }))).toBeNull();
    expect(clusterKey(sig({ affected_cve: "N/A", affected_vendor: "   " }))).toBeNull();
  });

  it("returns null for an unparseable timestamp on the fingerprint path", () => {
    expect(clusterKey(sig({ affected_vendor: "Acme", ingestion_timestamp: "not-a-date" }))).toBeNull();
  });

  it("is deterministic — same input yields the same key", () => {
    const s = sig({ affected_cve: "CVE-2026-1234" });
    expect(clusterKey(s)).toBe(clusterKey(s));
  });

  it("uses prefixed namespaces distinct from any dedup_hash (cve:/fp:)", () => {
    expect(clusterKey(sig({ affected_cve: "CVE-2026-1234" }))!.startsWith(CLUSTER_KEY_CVE_PREFIX)).toBe(true);
    expect(clusterKey(sig({ affected_vendor: "Acme" }))!.startsWith(CLUSTER_KEY_FP_PREFIX)).toBe(true);
  });
});
