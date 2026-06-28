/**
 * intelligenceBriefRanking.test.ts — Priority 4 / Phase 4B / B4.
 *
 * Proves the two properties the B4 flag-gated ranking must hold:
 *   1. FLAG-OFF IDENTITY — omitting `priorityOf` (the pre-B4 call) produces the
 *      exact same ordering as explicitly passing the legacy `sourcePriority`.
 *   2. FLAG-ON DIVERGENCE — a qualification-derived priority reorders ONLY the
 *      source-credibility tie-break (factor 4); KEV/severity/CVE (factors 1–3)
 *      still dominate.
 *
 * Operates on the pure exported ranking surface (buildBriefItems / shortlistTopK)
 * — no DB, no flag env, no Claude.
 */

import { describe, it, expect } from "vitest";
import {
  buildBriefItems,
  shortlistTopK,
  sourcePriority,
  type CyberSignalForBrief
} from "../lib/intelligenceBriefGenerator.js";
import {
  makeQualificationPriority,
  type QualificationRecord
} from "../lib/signals/sourceQualification.js";

let seq = 0;
function sig(part: Partial<CyberSignalForBrief>): CyberSignalForBrief {
  seq += 1;
  return {
    id: `id-${seq}`,
    signal_type: "cve",
    severity: "High",
    normalized_summary: `summary ${seq}`,
    affected_cve: `CVE-2026-${1000 + seq}`, // distinct ⇒ no CVE-merge
    affected_vendor: "ExampleCorp",
    source: "nvd",
    ingestion_timestamp: "2026-06-01T00:00:00.000Z", // identical ⇒ recency never breaks ties
    ...part
  };
}

const slugs = (items: Array<{ source_slug: string }>) => items.map((i) => i.source_slug);

describe("brief ranking — flag-off identity (B4)", () => {
  it("default priorityOf == explicit sourcePriority (byte-identical ordering)", () => {
    const signals = [
      sig({ source: "nvd" }),
      sig({ source: "krebsonsecurity" }),
      sig({ source: "cisa_alerts" }),
      sig({ source: "mitre_attack" })
    ];
    const itemsDefault = buildBriefItems(signals);
    const itemsLegacy = buildBriefItems(signals, sourcePriority);
    expect(slugs(itemsDefault)).toEqual(slugs(itemsLegacy));

    const shortDefault = shortlistTopK(itemsDefault, 10);
    const shortLegacy = shortlistTopK(itemsLegacy, 10, sourcePriority);
    expect(slugs(shortDefault)).toEqual(slugs(shortLegacy));
  });
});

describe("brief ranking — flag-on divergence on factor 4 only (B4)", () => {
  // tier-1 nvd (rel 50) vs tier-1 cisa_alerts (rel 95): same tier ⇒ reliability
  // breaks the tie, so cisa_alerts outranks nvd — the REVERSE of legacy, where
  // sourcePriority hardcodes nvd(1) above cisa_alerts(2).
  const qualMap = new Map<string, QualificationRecord>([
    ["nvd", { authorityTier: 1, reliability: 50 }],
    ["cisa_alerts", { authorityTier: 1, reliability: 95 }]
  ]);
  const qualPriority = makeQualificationPriority(qualMap, sourcePriority);

  it("legacy ranks nvd before cisa_alerts; qualification flips it", () => {
    // factors 1–3 identical (non-KEV, same severity, both have CVE) ⇒ factor 4 decides
    const signals = [sig({ source: "cisa_alerts" }), sig({ source: "nvd" })];
    const items = buildBriefItems(signals);

    const legacyOrder = slugs(shortlistTopK(items, 10, sourcePriority));
    expect(legacyOrder).toEqual(["nvd", "cisa_alerts"]);

    const qualOrder = slugs(shortlistTopK(items, 10, qualPriority));
    expect(qualOrder).toEqual(["cisa_alerts", "nvd"]);
  });

  it("does NOT override severity (factor 2 dominates factor 4)", () => {
    // low-severity cisa_alerts must still rank BELOW critical-severity nvd,
    // even though qualification favors cisa_alerts on credibility.
    const signals = [
      sig({ source: "nvd", severity: "Critical" }),
      sig({ source: "cisa_alerts", severity: "Low" })
    ];
    const items = buildBriefItems(signals, qualPriority);
    const order = slugs(shortlistTopK(items, 10, qualPriority));
    expect(order).toEqual(["nvd", "cisa_alerts"]);
  });
});
