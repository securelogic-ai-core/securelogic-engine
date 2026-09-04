/**
 * coreAssuranceComposition.test.ts — the 1.2.0 scope-rule corpus: Assessment
 * Composition v1 inside the ONE resolver.
 *
 * Proves, on a synthetic corpus that holds the Core Assurance Set beside a
 * legacy `core`-tagged framework:
 *   - core applicability (applicable objectives are the S1 floor);
 *   - non-applicable suppression (no later rule can re-add an objective the
 *     facts excluded — tier tags, fact triggers, obligations and domain rules
 *     all see the reduced universe);
 *   - legacy `core` is no longer unconditional baseline below tier 1, and is
 *     explained as such in `excluded`;
 *   - tier changes DEPTH (and tier tags) but never core applicability;
 *   - evidence-satisfied objectives stay applicable at `confirm` with the
 *     basis riding the item (S4 semantics unchanged);
 *   - the nominal relationship composes to NOTHING;
 *   - determinism, and byte-identity of 1.1.0 / 1.0.0 output for a corpus
 *     that contains the set (the stamp selects the corpus, not the constant).
 */

import { describe, expect, it } from "vitest";

import {
  resolveEngagementScope,
  resolveEngagementScopeWithApplicability,
  scopeVersionRunsCoreAssurance,
  type ScopableRequirement,
  type ScopeResolverInput,
} from "../lib/vendorRisk/scopeResolver.js";
import {
  CORE_ASSURANCE_FRAMEWORK_KEY,
  CORE_ASSURANCE_OBJECTIVES,
  CORE_ASSURANCE_REFERENCES,
} from "../lib/vendorRisk/coreAssuranceSet.js";
import { SCOPE_RULE_VERSION, SCOPE_RULE_VERSION_CORE } from "../lib/vendorRisk/methodologyVersion.js";
import type { InherentRiskInput } from "../lib/vendorRisk/inherentRisk.js";

const NOMINAL: InherentRiskInput = {
  data_sensitivity: "none",
  data_volume: "minimal",
  access_level: "none",
  operational_dependency: "low",
  recoverability: "hours",
  business_criticality: "low",
  regulatory_exposure: "none",
  regulatory_breach_notification: false,
  ai_involvement: "none",
  ai_autonomy: "none",
  hosting_model: "on_prem",
  fourth_party_exposure: "none",
  concentration: "none",
};

const PAYMENTS: InherentRiskInput = {
  ...NOMINAL,
  data_sensitivity: "restricted",
  data_volume: "large",
  access_level: "read_write",
  operational_dependency: "high",
  recoverability: "weeks",
  business_criticality: "high",
  regulatory_exposure: "high",
  regulatory_breach_notification: true,
  hosting_model: "multi_tenant_saas",
  fourth_party_exposure: "moderate",
};

/** The Core Assurance Set as the route would load it after provisioning. */
const CORE_CORPUS: ScopableRequirement[] = CORE_ASSURANCE_OBJECTIVES.map((o) => ({
  requirement_id: `cas:${o.reference}`,
  framework_id: "fw-core",
  reference_id: o.reference,
  title: o.title,
  scope_tags: [...o.tags],
  framework_key: CORE_ASSURANCE_FRAMEWORK_KEY,
}));

const req = (id: string, tags: string[], key: string | null = "soc2"): ScopableRequirement => ({
  requirement_id: id,
  framework_id: "fw-legacy",
  reference_id: id.toUpperCase(),
  title: `Requirement ${id}`,
  scope_tags: tags,
  framework_key: key,
});

/** A legacy activated framework with heuristic/curated `core` rows and domain rows. */
const LEGACY: ScopableRequirement[] = [
  req("legacy-core-1", ["core"]),
  req("legacy-core-2", ["core"]),
  req("legacy-acl-1", ["access-control"]),
  req("legacy-data-1", ["data-protection"]),
  req("legacy-resil-1", ["resilience"]),
  req("legacy-supply-1", ["supply-chain"]),
  req("legacy-privacy-1", ["privacy"]),
  req("customer-core-1", ["core"], null),
];

const CORPUS = [...CORE_CORPUS, ...LEGACY];

const base = (over: Partial<ScopeResolverInput> = {}): ScopeResolverInput => ({
  tier: "tier_3_moderate",
  inherent: PAYMENTS,
  requirements: CORPUS,
  obligationEdges: [],
  ...over,
});

const ids = (r: ReturnType<typeof resolveEngagementScope>) => r.items.map((i) => i.requirement_id).sort();
const coreIds = (r: ReturnType<typeof resolveEngagementScope>) =>
  ids(r).filter((i) => i.startsWith("cas:"));
const cas = (ref: string) => `cas:${ref}`;

describe("the corpus gate", () => {
  it("1.2.0 is the current constant and the Core Assurance gate; 1.1.0 and below never run it", () => {
    expect(SCOPE_RULE_VERSION).toBe("1.2.0");
    expect(SCOPE_RULE_VERSION_CORE).toBe("1.2.0");
    expect(scopeVersionRunsCoreAssurance("1.2.0")).toBe(true);
    expect(scopeVersionRunsCoreAssurance("2.0.0")).toBe(true);
    expect(scopeVersionRunsCoreAssurance("1.1.0")).toBe(false);
    expect(scopeVersionRunsCoreAssurance("1.0.0")).toBe(false);
    expect(scopeVersionRunsCoreAssurance("garbage")).toBe(false);
  });

  it("an engagement stamped 1.1.0 re-resolves WITHOUT core_assurance, even with the set in its library", () => {
    const r = resolveEngagementScope(base({ scopeRuleVersion: "1.1.0" }));
    expect(r.scope_rule_version).toBe("1.1.0");
    expect("core_assurance" in r).toBe(false);
    // and legacy `core` is still its baseline
    expect(ids(r)).toContain("legacy-core-1");
    // CAS rows are ordinary `core`-tagged requirements to the old corpus
    expect(ids(r)).toContain(cas("CAS-01"));
  });
});

describe("core applicability is the floor", () => {
  it("a payments relationship asks all sixteen objectives as S1.core.* mandatory items", () => {
    const r = resolveEngagementScope(base());
    expect(coreIds(r)).toEqual(CORE_ASSURANCE_REFERENCES.map(cas).sort());
    for (const item of r.items.filter((i) => i.requirement_id.startsWith("cas:"))) {
      expect(item.mandatory).toBe(true);
      const s1 = item.reasons.find((x) => x.rule_family === "S1")!;
      expect(s1.rule_id).toMatch(/^S1\.core\.cas_\d\d$/);
      expect(s1.rationale.length).toBeGreaterThan(20);
    }
    expect(r.core_assurance!.version).toBe("1.0");
    expect(r.core_assurance!.decisions).toHaveLength(16);
    expect(r.core_assurance!.missing).toEqual([]);
  });

  it("the applicability record carries every S1.core rule with its by-value basis", () => {
    const { applicability } = resolveEngagementScopeWithApplicability(base());
    const core = applicability.filter((a) => a.rule_id.startsWith("S1.core."));
    expect(core).toHaveLength(16);
    const cas14 = core.find((a) => a.rule_id === "S1.core.cas_14")!;
    expect(cas14.requirement_reference_id).toBe("CAS-14");
    expect(cas14.basis).toMatchObject({
      tier: "tier_3_moderate",
      core_assurance_version: "1.0",
      signals: { handles_data: true },
      facts: { "core.data_sensitivity": "restricted" },
    });
  });

  it("missing objectives are reported, never silently absent", () => {
    const r = resolveEngagementScope(base({ requirements: [...CORE_CORPUS.slice(0, 10), ...LEGACY] }));
    expect(r.core_assurance!.missing).toEqual(CORE_ASSURANCE_REFERENCES.slice(10));
  });
});

describe("non-applicable suppression is final", () => {
  const dataOnlyNoTech: InherentRiskInput = { ...NOMINAL, data_sensitivity: "confidential" };

  it("an objective the facts exclude is not asked, is in `excluded` with its own reason, and is a recorded decision", () => {
    const r = resolveEngagementScope(base({ inherent: dataOnlyNoTech }));
    expect(ids(r)).not.toContain(cas("CAS-10"));
    expect(ids(r)).not.toContain(cas("CAS-11"));
    const ex = r.excluded.find((e) => e.requirement_id === cas("CAS-10"))!;
    expect(ex.rationale).toMatch(/do not materially depend/);
    const d = r.core_assurance!.decisions.find((x) => x.reference === "CAS-10")!;
    expect(d.applicable).toBe(false);
    expect(d.requirement_id).toBe(cas("CAS-10"));
  });

  it("no tier tag can re-add it: tier 1's `*` still honours the factual exclusion", () => {
    const r = resolveEngagementScope(base({ inherent: dataOnlyNoTech, tier: "tier_1_critical" }));
    expect(ids(r)).toContain("legacy-core-1"); // `*` takes everything else
    expect(ids(r)).not.toContain(cas("CAS-10"));
    expect(ids(r)).not.toContain(cas("CAS-11"));
  });

  it("no domain rule can re-add it: a tier-2 vendor with no dependency gets legacy resilience items, not CAS-10", () => {
    // tier 2 activates the resilience domain by tier alone (S5.resilience.tier).
    const r = resolveEngagementScope(base({ inherent: dataOnlyNoTech, tier: "tier_2_high" }));
    expect(ids(r)).toContain("legacy-resil-1");
    expect(ids(r)).not.toContain(cas("CAS-10"));
  });

  it("no obligation can re-add it", () => {
    const r = resolveEngagementScope(
      base({
        inherent: dataOnlyNoTech,
        obligationEdges: [{ obligation_id: "o1", obligation_title: "DORA", requirement_id: cas("CAS-10") }],
      })
    );
    expect(ids(r)).not.toContain(cas("CAS-10"));
  });

  it("the applicability record never contains a rule for an excluded objective", () => {
    const { applicability } = resolveEngagementScopeWithApplicability(base({ inherent: dataOnlyNoTech }));
    expect(applicability.some((a) => a.requirement_id === cas("CAS-10"))).toBe(false);
  });
});

describe("legacy `core` is no longer unconditional baseline below tier 1", () => {
  it("at tiers 2-4 a legacy core-only requirement is excluded with the Core Assurance explanation", () => {
    for (const tier of ["tier_2_high", "tier_3_moderate", "tier_4_low"] as const) {
      const r = resolveEngagementScope(base({ tier }));
      expect(ids(r), tier).not.toContain("legacy-core-1");
      expect(ids(r), tier).not.toContain("customer-core-1");
      const ex = r.excluded.find((e) => e.requirement_id === "legacy-core-1")!;
      expect(ex.rationale, tier).toMatch(/baseline at .* is the SecureLogic Core Assurance Set/);
    }
  });

  it("tier 1 still takes every requirement of every activated framework", () => {
    const r = resolveEngagementScope(base({ tier: "tier_1_critical" }));
    expect(ids(r)).toContain("legacy-core-1");
    expect(ids(r)).toContain("customer-core-1");
  });

  it("legacy requirements still enter through tier tags, fact triggers and domains", () => {
    const r = resolveEngagementScope(base({ tier: "tier_3_moderate" }));
    expect(ids(r)).toContain("legacy-acl-1"); // tier-3 tag + S2.access
    expect(ids(r)).toContain("legacy-data-1"); // tier-3 tag + S2 sensitivity
    expect(ids(r)).toContain("legacy-supply-1"); // S5.nth.fourth_party (moderate)
    expect(ids(r)).toContain("legacy-resil-1"); // S5.resilience.dependency (high)
  });
});

describe("tier changes depth, never core applicability", () => {
  it("the same facts give the same applicable objectives at every tier", () => {
    const sets = (["tier_1_critical", "tier_2_high", "tier_3_moderate", "tier_4_low"] as const).map((tier) =>
      coreIds(resolveEngagementScope(base({ tier })))
    );
    for (const s of sets) expect(s).toEqual(sets[0]);
  });

  it("tier 4 asks the objectives at attest depth; tiers 1-3 in full", () => {
    const t4 = resolveEngagementScope(base({ tier: "tier_4_low" }));
    const t2 = resolveEngagementScope(base({ tier: "tier_2_high" }));
    const depth = (r: typeof t4, ref: string) => r.items.find((i) => i.requirement_id === cas(ref))!.depth;
    expect(depth(t4, "CAS-01")).toBe("attest");
    expect(depth(t2, "CAS-01")).toBe("full");
    // and tier 2 asks more overall (tier tags + resilience by tier)
    expect(t2.items.length).toBeGreaterThan(t4.items.length);
  });

  it("the sixteen are the floor: a tier-4 target of 15 is exceeded by the floor and recorded, never truncated", () => {
    const r = resolveEngagementScope(base({ tier: "tier_4_low" }));
    expect(coreIds(r)).toHaveLength(16);
    // The floor is the sixteen plus whatever the security baseline activation
    // marks (here the access-control item S2 pulled in): >= 16, never fewer.
    expect(r.composition!.mandatory).toBeGreaterThanOrEqual(16);
    expect(r.composition!.nominal_target).toBe(15);
    expect(r.composition!.mandatory_overage).toBe(r.composition!.mandatory - 15);
    // Discretionary items compete for the room the floor leaves (none, here)
    // and are dropped with the overflow RECORDED; no objective is ever dropped.
    const dropped = new Set(r.truncated?.dropped_requirement_ids ?? []);
    for (const ref of CORE_ASSURANCE_REFERENCES) expect(dropped.has(cas(ref)), ref).toBe(false);
  });
});

describe("evidence-aware composition (S4 semantics unchanged)", () => {
  it("a governed-evidence-covered objective stays applicable at confirm depth with the basis riding the item", () => {
    const basis = { determination_id: "det-1", document_id: "doc-1", valid_until: "2027-01-31" };
    const r = resolveEngagementScope(
      base({
        assuranceCoveredRequirementIds: [cas("CAS-06")],
        assuranceCoverageBasis: { [cas("CAS-06")]: basis },
      })
    );
    const item = r.items.find((i) => i.requirement_id === cas("CAS-06"))!;
    expect(item.depth).toBe("confirm");
    expect(item.mandatory).toBe(true);
    const s4 = item.reasons.find((x) => x.rule_id === "S4.assurance")!;
    expect(s4.basis).toEqual(basis);
    // still counted as applicable
    expect(r.core_assurance!.decisions.find((d) => d.reference === "CAS-06")!.applicable).toBe(true);
  });

  it("evidence never widens: coverage of an objective the facts excluded changes nothing", () => {
    const r = resolveEngagementScope(
      base({
        inherent: { ...NOMINAL, data_sensitivity: "confidential" },
        assuranceCoveredRequirementIds: [cas("CAS-10")],
      })
    );
    expect(ids(r)).not.toContain(cas("CAS-10"));
  });

  it("a SOC report covering one objective does not bypass the rest", () => {
    const r = resolveEngagementScope(base({ assuranceCoveredRequirementIds: [cas("CAS-06")] }));
    const full = r.items.filter((i) => i.requirement_id.startsWith("cas:") && i.depth === "full");
    expect(full).toHaveLength(15);
  });
});

describe("the nominal relationship", () => {
  it("composes to NOTHING — no core objective applies, no trigger fires, no domain beyond security activates", () => {
    const r = resolveEngagementScope(base({ inherent: NOMINAL, tier: "tier_4_low" }));
    expect(r.items).toEqual([]);
    expect(r.core_assurance!.decisions.every((d) => !d.applicable)).toBe(true);
    expect(r.excluded).toHaveLength(CORPUS.length);
    expect(r.composition!.total).toBe(0);
  });

  it("but an ACTIVE obligation still reaches a non-core requirement: compliance is not suppressed by nominal facts", () => {
    const r = resolveEngagementScope(
      base({
        inherent: NOMINAL,
        tier: "tier_4_low",
        obligationEdges: [{ obligation_id: "o1", obligation_title: "GDPR", requirement_id: "legacy-privacy-1" }],
      })
    );
    expect(ids(r)).toEqual(["legacy-privacy-1"]);
  });
});

describe("determinism and reproduction", () => {
  it("the same inputs produce byte-identical output", () => {
    const a = JSON.stringify(resolveEngagementScope(base()));
    const b = JSON.stringify(resolveEngagementScope(base()));
    expect(a).toBe(b);
  });

  it("items, decisions and exclusions are the same sets regardless of input order", () => {
    const a = resolveEngagementScope(base());
    const b = resolveEngagementScope(base({ requirements: [...CORPUS].reverse() }));
    expect(JSON.stringify(a.items)).toBe(JSON.stringify(b.items));
    expect(JSON.stringify(a.core_assurance)).toBe(JSON.stringify(b.core_assurance));
    const key = (e: { requirement_id: string; rationale: string }) => `${e.requirement_id}|${e.rationale}`;
    expect(a.excluded.map(key).sort()).toEqual(b.excluded.map(key).sort());
  });

  it("the resolution's core_assurance block is sorted by reference and carries no scoring internals", () => {
    const r = resolveEngagementScope(base());
    const refs = r.core_assurance!.decisions.map((d) => d.reference);
    expect(refs).toEqual([...refs].sort());
    const text = JSON.stringify(r.core_assurance);
    expect(text).not.toMatch(/weight|score|contribution/);
  });
});
