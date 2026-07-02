/**
 * signalClustering.test.ts — Priority 4 / Phase 4C / C3a.
 *
 * C3a is read-path plumbing only: it makes the persisted cluster_key (C2)
 * available on CyberSignalForBrief and adds the clustering flag. Nothing consumes
 * either yet (the C3b bucketing pass does). These tests pin:
 *   - the flag default (OFF everywhere, true only on "true"), and
 *   - that carrying cluster_key on the input rows does NOT change the brief
 *     items buildBriefItems produces (plumbing is inert).
 */

import { describe, it, expect } from "vitest";
import { signalClusteringEnabled } from "../../lib/signals/signalClustering.js";
import {
  buildBriefItems,
  type CyberSignalForBrief
} from "../../lib/intelligenceBriefGenerator.js";

describe("signalClusteringEnabled — flag (C3a)", () => {
  it("is true ONLY when the env var === 'true' (OFF everywhere by default)", () => {
    expect(signalClusteringEnabled({ SECURELOGIC_SIGNAL_CLUSTERING_ENABLED: "true" })).toBe(true);
    for (const v of [undefined, "", "false", "1", "TRUE", "yes"]) {
      expect(
        signalClusteringEnabled({ SECURELOGIC_SIGNAL_CLUSTERING_ENABLED: v as string })
      ).toBe(false);
    }
    expect(signalClusteringEnabled({})).toBe(false);
  });
});

let seq = 0;
function sig(part: Partial<CyberSignalForBrief>): CyberSignalForBrief {
  seq += 1;
  return {
    id: `id-${seq}`,
    signal_type: "cve",
    severity: "High",
    normalized_summary: `summary ${seq}`,
    affected_cve: `CVE-2026-${1000 + seq}`,
    affected_vendor: "ExampleCorp",
    source: "nvd",
    ingestion_timestamp: "2026-06-28T00:00:00.000Z",
    ...part
  };
}

describe("C3a plumbing is inert (cluster_key carried but unconsumed)", () => {
  it("CyberSignalForBrief accepts cluster_key and buildBriefItems output is unchanged by it", () => {
    const withoutKey = [sig({ source: "nvd" }), sig({ source: "krebsonsecurity", affected_cve: null, affected_vendor: "Acme" })];
    // Same signals but with cluster_key populated on the input rows.
    seq = 0;
    const withKey = [
      sig({ source: "nvd", cluster_key: "cve:CVE-2026-1001" }),
      sig({ source: "krebsonsecurity", affected_cve: null, affected_vendor: "Acme", cluster_key: "fp:acme|cve|2026-06-28" })
    ];

    const a = buildBriefItems(withoutKey);
    const b = buildBriefItems(withKey);

    // buildBriefItems ignores cluster_key entirely in C3a ⇒ identical BriefItems.
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    // and cluster_key never appears on the produced items (not serialized in C3a)
    expect(JSON.stringify(b)).not.toContain("cluster_key");
  });
});
