/**
 * intelligenceEventIdentity.test.ts — Intelligence Pipeline Hardening / IE.P1.
 *
 * Pins the canonical-event identity contract: a TOTAL promotion of clusterKey()
 * (CVE-primary, else CVE-less fingerprint, else per-signal singleton on
 * dedup_hash), deterministic and global, plus severity peak ordering.
 */

import { describe, it, expect } from "vitest";
import {
  eventCanonicalKey,
  isSingletonKey,
  severityRank,
  peakSeverity,
  EVENT_KEY_SINGLETON_PREFIX,
  type EventIdentityInput
} from "../../lib/signals/intelligenceEventIdentity.js";
import { CLUSTER_KEY_CVE_PREFIX, CLUSTER_KEY_FP_PREFIX } from "../../lib/signals/clusterKey.js";

function sig(part: Partial<EventIdentityInput>): EventIdentityInput {
  return {
    affected_cve: null,
    affected_vendor: null,
    signal_type: "advisory",
    ingestion_timestamp: "2026-07-07T12:00:00.000Z",
    dedup_hash: "deadbeef",
    ...part
  };
}

describe("eventCanonicalKey — total identity", () => {
  it("keys on the CVE when present, source/vendor-agnostic", () => {
    const a = eventCanonicalKey(sig({ affected_cve: "CVE-2026-1234", affected_vendor: "acme" }));
    const b = eventCanonicalKey(sig({ affected_cve: "cve-2026-1234", affected_vendor: "other" }));
    expect(a).toBe(`${CLUSTER_KEY_CVE_PREFIX}CVE-2026-1234`);
    expect(b).toBe(a); // same CVE → same event regardless of vendor/case
  });

  it("falls back to vendor|type|day fingerprint when CVE-less but vendor present", () => {
    const k = eventCanonicalKey(sig({ affected_vendor: "Acme Corp", signal_type: "breach" }));
    expect(k).toBe(`${CLUSTER_KEY_FP_PREFIX}acme corp|breach|2026-07-07`);
  });

  it("falls back to a stable singleton on dedup_hash when degenerate (no CVE, no vendor)", () => {
    const k = eventCanonicalKey(sig({ dedup_hash: "abc123" }));
    expect(k).toBe(`${EVENT_KEY_SINGLETON_PREFIX}abc123`);
    expect(isSingletonKey(k)).toBe(true);
  });

  it("is total — never returns null/empty for any signal", () => {
    for (const s of [
      sig({}),
      sig({ affected_cve: "CVE-2026-1" }),
      sig({ affected_vendor: "v" }),
      sig({ ingestion_timestamp: "not-a-date", affected_vendor: "v" }) // unparseable → singleton
    ]) {
      const k = eventCanonicalKey(s);
      expect(typeof k).toBe("string");
      expect(k.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic — same input yields same key", () => {
    const s = sig({ affected_vendor: "v", signal_type: "patch" });
    expect(eventCanonicalKey(s)).toBe(eventCanonicalKey(s));
  });

  it("distinct degenerate signals do not over-merge (different dedup_hash → different event)", () => {
    expect(eventCanonicalKey(sig({ dedup_hash: "h1" }))).not.toBe(eventCanonicalKey(sig({ dedup_hash: "h2" })));
  });
});

describe("severity ordering", () => {
  it("ranks Critical..Low ascending, unknown last", () => {
    expect(severityRank("Critical")).toBeLessThan(severityRank("High"));
    expect(severityRank("High")).toBeLessThan(severityRank("Moderate"));
    expect(severityRank("Moderate")).toBeLessThan(severityRank("Low"));
    expect(severityRank("bogus")).toBeGreaterThan(severityRank("Low"));
  });

  it("peakSeverity returns the more-severe of two", () => {
    expect(peakSeverity("Low", "Critical")).toBe("Critical");
    expect(peakSeverity("High", "Moderate")).toBe("High");
    expect(peakSeverity("Low", "bogus")).toBe("Low");
  });
});
