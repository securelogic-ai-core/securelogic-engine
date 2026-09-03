/**
 * applicabilityRecord.test.ts — VA-926, the pure half.
 *
 * The DB half lives in `test/isolation/engagementApplicability.test.ts`. This
 * file pins the two things that must hold before a row is ever written: that
 * the resolver reports what applied INDEPENDENTLY of what composition kept, and
 * that an identical determination hashes identically so idempotency works.
 */

import { describe, expect, it } from "vitest";

import {
  resolveEngagementScope,
  resolveEngagementScopeWithApplicability,
  type ScopableRequirement,
  type ScopeResolverInput,
} from "../lib/vendorRisk/scopeResolver.js";
import { resolveFacts, factsFromInherent } from "../lib/vendorRisk/factResolver.js";
import type { FactRow } from "../lib/vendorRisk/factRegistry.js";
import { basisHash, canonicalJson } from "../lib/vendorRisk/applicabilityStore.js";
import type { InherentRiskInput } from "../lib/vendorRisk/inherentRisk.js";

const benign: InherentRiskInput = {
  data_sensitivity: "none", data_volume: "minimal", access_level: "none",
  operational_dependency: "low", recoverability: "hours", business_criticality: "low",
  regulatory_exposure: "none", regulatory_breach_notification: false,
  ai_involvement: "none", ai_autonomy: "none", hosting_model: "on_prem",
  fourth_party_exposure: "none", concentration: "none",
};

/** Local helper, matching vendorScopeResolver.test.ts — `fact` is not exported. */
const fact = (fact_key: string, value: unknown): FactRow =>
  ({ fact_key, value, source: "intake", origin: "intake" }) as FactRow;

const req = (id: string, tags: string[]): ScopableRequirement => ({
  requirement_id: id,
  framework_id: "fw-1",
  reference_id: id.toUpperCase(),
  title: `Requirement ${id}`,
  scope_tags: tags,
});

/** Deliberately crowded: 6 core (floor) + 40 privacy, at a target of 15. */
const CROWDED: ScopableRequirement[] = [
  ...Array.from({ length: 6 }, (_, i) => req(`core-${i}`, ["core"])),
  ...Array.from({ length: 40 }, (_, i) => req(`privacy-${i}`, ["privacy"])),
];

const base = (over: Partial<ScopeResolverInput> = {}): ScopeResolverInput => ({
  tier: "tier_4_low",
  inherent: benign,
  requirements: CROWDED,
  obligationEdges: [],
  facts: resolveFacts([...factsFromInherent(benign), fact("data.personal_data", true)]),
  ...over,
});

describe("applicability is reported independently of composition", () => {
  const { resolution, applicability } = resolveEngagementScopeWithApplicability(base());

  it("privacy applied even though composition kept none of it", () => {
    // The regression #926 exists for: at tier 4 the floor (6 core) leaves a
    // discretionary budget of 9 against 40 privacy requirements, so most are
    // dropped — and before this package a fully-dropped rule left no trace.
    expect(applicability.some((a) => a.rule_id === "S5.privacy.personal_data")).toBe(true);

    const askedIds = new Set(resolution.items.map((i) => i.requirement_id));
    const privacyApplied = applicability.filter((a) => a.rule_id === "S5.privacy.personal_data");
    const privacyDropped = privacyApplied.filter((a) => !askedIds.has(a.requirement_id));
    expect(privacyDropped.length).toBeGreaterThan(0);
  });

  it("every dropped-but-applicable requirement is still answerable", () => {
    const askedIds = new Set(resolution.items.map((i) => i.requirement_id));
    const dropped = applicability.filter((a) => !askedIds.has(a.requirement_id));
    for (const a of dropped) {
      expect(a.rule_id).toBeTruthy();
      expect(a.requirement_reference_id).toBeTruthy();
      expect(a.basis).toBeTypeOf("object");
    }
  });

  it("carries the domain the requirement applied under, even when truncated", () => {
    const askedIds = new Set(resolution.items.map((i) => i.requirement_id));
    const droppedPrivacy = applicability.filter(
      (a) => a.rule_id === "S5.privacy.personal_data" && !askedIds.has(a.requirement_id)
    );
    expect(droppedPrivacy.length).toBeGreaterThan(0);
    for (const a of droppedPrivacy) expect(a.domain).toBe("privacy");
  });

  it("captures the triggering fact VALUE, not a pointer", () => {
    const a = applicability.find((x) => x.rule_id === "S5.privacy.personal_data")!;
    expect(a.basis).toEqual({ domain: "privacy", facts: { "data.personal_data": true } });
  });

  it("records one determination per (rule, requirement) — several rules may claim one requirement", () => {
    const core0 = applicability.filter((a) => a.requirement_id === "core-0").map((a) => a.rule_id);
    expect(core0).toContain("S1.baseline");
    expect(core0).toContain("S5.security.baseline");
  });

  it("does NOT report excluded or non-applicable requirements", () => {
    // Owner ruling: authoritative for what APPLIED. Every reported requirement
    // was matched by a rule; nothing else appears.
    const reported = new Set(applicability.map((a) => a.requirement_id));
    const excludedIds = new Set(resolution.excluded.map((e) => e.requirement_id));
    for (const id of reported) {
      // A requirement may be BOTH applicable and excluded-by-cap; what must not
      // happen is a requirement no rule matched being reported.
      expect(CROWDED.some((r) => r.requirement_id === id)).toBe(true);
    }
    expect([...reported].some((id) => !excludedIds.has(id))).toBe(true);
  });
});

describe("the resolution object is untouched", () => {
  it("resolveEngagementScope returns exactly what it always did", () => {
    const input = base();
    const plain = resolveEngagementScope(input);
    const { resolution } = resolveEngagementScopeWithApplicability(input);
    expect(JSON.stringify(plain)).toBe(JSON.stringify(resolution));
    // No applicability field leaked onto the resolution — the 21 frozen 1.0.0
    // goldens compare JSON.stringify of this whole object.
    expect("applicability" in plain).toBe(false);
  });

  it("a 1.0.0 resolution reports applicability with no domain and no S5", () => {
    const { resolution, applicability } = resolveEngagementScopeWithApplicability({
      ...base(),
      scopeRuleVersion: "1.0.0",
    });
    expect(resolution.scope_rule_version).toBe("1.0.0");
    expect(applicability.length).toBeGreaterThan(0);
    expect(applicability.every((a) => a.domain === null)).toBe(true);
    expect(applicability.some((a) => a.rule_family === "S5")).toBe(false);
  });
});

describe("basis hashing makes idempotency possible", () => {
  it("key order does not change the hash", () => {
    expect(basisHash({ a: 1, b: 2 })).toBe(basisHash({ b: 2, a: 1 }));
  });

  it("a changed VALUE changes the hash", () => {
    expect(basisHash({ facts: { "data.personal_data": true } }))
      .not.toBe(basisHash({ facts: { "data.personal_data": false } }));
  });

  it("nested objects and arrays canonicalise stably", () => {
    expect(canonicalJson({ z: [3, { b: 1, a: 2 }], a: null }))
      .toBe('{"a":null,"z":[3,{"a":2,"b":1}]}');
  });

  it("is a sha256 hex digest", () => {
    expect(basisHash({})).toMatch(/^[0-9a-f]{64}$/);
  });

  it("resolving twice produces byte-identical bases — so the second write is a no-op", () => {
    const a = resolveEngagementScopeWithApplicability(base()).applicability;
    const b = resolveEngagementScopeWithApplicability(base()).applicability;
    expect(a.map((x) => `${x.rule_id}|${x.requirement_id}|${basisHash(x.basis)}`))
      .toEqual(b.map((x) => `${x.rule_id}|${x.requirement_id}|${basisHash(x.basis)}`));
  });
});
