/**
 * discoveryConfidence.test.ts — ERIP E2.P3: the pure conflict-resolution +
 * confidence core (ERIP-AD-12). Deterministic; fixed clock.
 */

import { describe, expect, it } from "vitest";
import {
  summarizeDiscovery,
  computeConfidence,
  type ObservationFact
} from "../lib/discoveryConfidence.js";

const NOW = new Date("2026-07-06T00:00:00Z");

function fact(over: Partial<ObservationFact> = {}): ObservationFact {
  return {
    connector_id: "servicenow_cmdb",
    category: "cmdb",
    external_ref: "ci-1",
    entity_type: "application",
    name: "Billing",
    stale: false,
    last_seen_at: "2026-07-05T00:00:00Z",
    ...over
  };
}

describe("computeConfidence", () => {
  it("is 0 for no observations", () => {
    expect(computeConfidence([], NOW)).toBe(0);
  });

  it("a single fresh agreeing source scores 60 (base 50 + agreement 10)", () => {
    expect(computeConfidence([fact()], NOW)).toBe(60);
  });

  it("corroborating sources add up to +40, capped", () => {
    const two = [fact(), fact({ connector_id: "microsoft_defender", category: "endpoint" })];
    // base 50 + 20 (2nd source) + 10 (names agree) = 80
    expect(computeConfidence(two, NOW)).toBe(80);
    const four = [
      fact(),
      fact({ connector_id: "microsoft_defender", category: "endpoint" }),
      fact({ connector_id: "wiz", category: "cloud" }),
      fact({ connector_id: "tenable", category: "vulnerability" })
    ];
    // base 50 + min(3*20,40)=40 + 10 = 100
    expect(computeConfidence(four, NOW)).toBe(100);
  });

  it("staleness and age reduce the score", () => {
    // A lone stale source is fully_stale → -40: 50 +10 -40 = 20.
    expect(computeConfidence([fact({ stale: true })], NOW)).toBe(20);
    // One fresh source + one stale corroborator: winner fresh, not all stale
    // → -25 not applied to winner; +20 corroboration, +10 agreement: 50+20+10-0=80.
    expect(
      computeConfidence([fact(), fact({ connector_id: "wiz", category: "cloud", stale: true })], NOW)
    ).toBe(80);
    const old = fact({ last_seen_at: "2026-05-01T00:00:00Z" });
    expect(computeConfidence([old], NOW)).toBe(50); // 50 +10 -10 (age > 30d)
  });
});

describe("summarizeDiscovery — conflict resolution (ERIP-AD-12)", () => {
  it("CMDB outranks a scanner for the effective name; contest is flagged", () => {
    const facts = [
      fact({ connector_id: "servicenow_cmdb", category: "cmdb", name: "Billing Service" }),
      fact({ connector_id: "microsoft_defender", category: "endpoint", name: "billing-01" })
    ];
    const s = summarizeDiscovery(facts, NOW);
    expect(s.source_count).toBe(2);
    expect(s.sources).toEqual(["microsoft_defender", "servicenow_cmdb"]);
    expect(s.effective_name).toMatchObject({ value: "Billing Service", winning_connector: "servicenow_cmdb", contested: true });
  });

  it("recency breaks ties within equal precedence", () => {
    const facts = [
      fact({ connector_id: "tenable", category: "vulnerability", name: "old-name", last_seen_at: "2026-07-01T00:00:00Z" }),
      fact({ connector_id: "qualys", category: "vulnerability", name: "new-name", last_seen_at: "2026-07-05T00:00:00Z" })
    ];
    expect(summarizeDiscovery(facts, NOW).effective_name).toMatchObject({ value: "new-name", winning_connector: "qualys" });
  });

  it("agreement is not contested", () => {
    const facts = [
      fact({ connector_id: "servicenow_cmdb", category: "cmdb", name: "Same" }),
      fact({ connector_id: "wiz", category: "cloud", name: "Same" })
    ];
    expect(summarizeDiscovery(facts, NOW).effective_name?.contested).toBe(false);
  });

  it("surfaces staleness", () => {
    const partial = summarizeDiscovery([fact(), fact({ connector_id: "wiz", category: "cloud", stale: true })], NOW);
    expect(partial.partially_stale).toBe(true);
    expect(partial.fully_stale).toBe(false);

    const full = summarizeDiscovery([fact({ stale: true })], NOW);
    expect(full.fully_stale).toBe(true);
  });
});

describe("summarizeDiscovery — owner + metadata (E2.P4, ERIP-AD-13)", () => {
  it("resolves the owner hint by precedence and merges metadata (higher rank wins keys)", () => {
    const facts = [
      fact({
        connector_id: "servicenow_cmdb",
        category: "cmdb",
        owner_hint: "cmdb-owner@corp.com",
        metadata: { os: "RHEL 9", ip_address: "10.0.0.5" }
      }),
      fact({
        connector_id: "tenable",
        category: "vulnerability",
        owner_hint: "scanner-owner@corp.com",
        metadata: { os: "Linux", cve_count: "3" }
      })
    ];
    const s = summarizeDiscovery(facts, NOW);
    // cmdb (rank 5) wins the owner + the os key; tenable-only keys still merge in.
    expect(s.effective_owner_hint).toMatchObject({ value: "cmdb-owner@corp.com", winning_connector: "servicenow_cmdb" });
    expect(s.metadata).toEqual({ os: "RHEL 9", ip_address: "10.0.0.5", cve_count: "3" });
  });

  it("effective_owner_hint is null when no source reports an owner", () => {
    const s = summarizeDiscovery([fact(), fact({ connector_id: "wiz", category: "cloud" })], NOW);
    expect(s.effective_owner_hint).toBeNull();
    expect(s.metadata).toEqual({});
  });
});
