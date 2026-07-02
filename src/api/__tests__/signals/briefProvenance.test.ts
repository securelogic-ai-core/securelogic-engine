/**
 * briefProvenance.test.ts — Priority 4 / Phase 4D / D2.
 *
 * The provenance flag, the pure edge builder, and the output-inert guarantee
 * (contributing_signal_ids never reaches content_json).
 */

import { describe, it, expect } from "vitest";
import {
  briefProvenanceEnabled,
  buildProvenanceRows
} from "../../lib/signals/briefProvenance.js";
import {
  buildBriefItems,
  buildContentJson,
  type CyberSignalForBrief
} from "../../lib/intelligenceBriefGenerator.js";

describe("briefProvenanceEnabled — flag (D2)", () => {
  it("is true ONLY when the env var === 'true' (OFF by default)", () => {
    expect(briefProvenanceEnabled({ SECURELOGIC_BRIEF_PROVENANCE_ENABLED: "true" })).toBe(true);
    for (const v of [undefined, "", "false", "1", "TRUE"]) {
      expect(briefProvenanceEnabled({ SECURELOGIC_BRIEF_PROVENANCE_ENABLED: v as string })).toBe(false);
    }
    expect(briefProvenanceEnabled({})).toBe(false);
  });
});

describe("buildProvenanceRows — edge builder (D2)", () => {
  const sourceById = new Map<string, string | null>([
    ["s1", "nvd"],
    ["s2", "bleepingcomputer"],
    ["s3", "krebsonsecurity"]
  ]);

  it("emits one canonical + N corroborating edges with denormalised source/cluster", () => {
    const rows = buildProvenanceRows(
      { cyber_signal_id: "s1", source_slug: "nvd", contributing_signal_ids: ["s1", "s2", "s3"] },
      "bi-1",
      "org-1",
      "cve:CVE-2026-1234",
      sourceById
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      organization_id: "org-1",
      brief_item_id: "bi-1",
      cyber_signal_id: "s1",
      source_slug: "nvd",
      cluster_key: "cve:CVE-2026-1234",
      relation: "canonical"
    });
    expect(rows.filter((r) => r.relation === "corroborating").map((r) => r.cyber_signal_id).sort()).toEqual(["s2", "s3"]);
    expect(rows.find((r) => r.cyber_signal_id === "s2")!.source_slug).toBe("bleepingcomputer");
  });

  it("a singleton item yields exactly one canonical edge", () => {
    const rows = buildProvenanceRows(
      { cyber_signal_id: "s1", source_slug: "nvd", contributing_signal_ids: ["s1"] },
      "bi-2",
      "org-1",
      null,
      sourceById
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].relation).toBe("canonical");
    expect(rows[0].cluster_key).toBeNull();
  });

  it("falls back to [canonical] when contributing list is absent; dedups repeats", () => {
    expect(buildProvenanceRows({ cyber_signal_id: "s1", source_slug: "nvd" }, "bi", "org", null)).toHaveLength(1);
    const dup = buildProvenanceRows(
      { cyber_signal_id: "s1", source_slug: "nvd", contributing_signal_ids: ["s1", "s1", "s2"] },
      "bi",
      "org",
      null
    );
    expect(dup).toHaveLength(2); // s1 once (canonical) + s2
  });

  it("returns [] when there is no canonical signal id", () => {
    expect(buildProvenanceRows({ cyber_signal_id: "", source_slug: null }, "bi", "org", null)).toEqual([]);
  });
});

let seq = 0;
function sig(part: Partial<CyberSignalForBrief>): CyberSignalForBrief {
  seq += 1;
  return {
    id: `id-${seq}`,
    signal_type: "cve",
    severity: "High",
    normalized_summary: `s ${seq}`,
    affected_cve: `CVE-2026-${1000 + seq}`,
    affected_vendor: "Acme",
    source: "nvd",
    ingestion_timestamp: "2026-06-28T00:00:00.000Z",
    ...part
  };
}

describe("D2 output-inert — contributing_signal_ids never in content_json", () => {
  it("buildBriefItems carries it, but buildContentJson strips it", () => {
    const items = buildBriefItems([sig({ source: "nvd" }), sig({ source: "krebsonsecurity" })]);
    // present internally for the persist layer
    expect(items.every((i) => Array.isArray(i.contributing_signal_ids))).toBe(true);
    // absent from the serialized content
    const json = buildContentJson(items, "2026-06-21", "2026-06-28");
    expect(JSON.stringify(json)).not.toContain("contributing_signal_ids");
  });
});
