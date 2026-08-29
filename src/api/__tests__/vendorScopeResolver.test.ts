/**
 * vendorScopeResolver.test.ts — deterministic questionnaire scoping.
 *
 * The ratified principle these tests exist to hold:
 *
 *   "Questionnaire scope must be deterministic first, AI-assisted second. AI must
 *    not be the opaque authority deciding which controls apply."
 *
 * So the assertions that matter are: same inputs -> same scope, every included
 * requirement carries a reason a customer can read, and nothing is dropped
 * silently.
 */
import { describe, it, expect } from "vitest";
import {
  CONTEXT_TRIGGERS,
  resolveEngagementScope,
  type ScopableRequirement,
  type ScopeResolverInput,
} from "../lib/vendorRisk/scopeResolver.js";
import type { InherentRiskInput } from "../lib/vendorRisk/inherentRisk.js";
import { SCOPE_RULE_VERSION } from "../lib/vendorRisk/methodologyVersion.js";

const benign: InherentRiskInput = {
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

const req = (id: string, tags: string[]): ScopableRequirement => ({
  requirement_id: id,
  framework_id: "fw-1",
  reference_id: id.toUpperCase(),
  title: `Requirement ${id}`,
  scope_tags: tags,
});

/** A small corpus spanning the tag groups the rules reference. */
const CORPUS: ScopableRequirement[] = [
  req("core-1", ["core"]),
  req("core-2", ["core"]),
  req("acl-1", ["access-control"]),
  req("iam-1", ["iam"]),
  req("priv-1", ["privileged-access"]),
  req("data-1", ["data-protection"]),
  req("privacy-1", ["privacy"]),
  req("tenancy-1", ["tenancy-isolation"]),
  req("ai-1", ["ai-governance"]),
  req("oversight-1", ["human-oversight"]),
  req("supply-1", ["supply-chain"]),
  req("resil-1", ["resilience"]),
  req("obscure-1", ["niche-topic"]),
];

const base = (over: Partial<ScopeResolverInput> = {}): ScopeResolverInput => ({
  tier: "tier_3_moderate",
  inherent: benign,
  requirements: CORPUS,
  obligationEdges: [],
  ...over,
});

const idsOf = (r: ReturnType<typeof resolveEngagementScope>) =>
  r.items.map((i) => i.requirement_id).sort();

// ─── Determinism ────────────────────────────────────────────────────────────

describe("scope resolution — determinism", () => {
  it("identical inputs produce byte-identical output", () => {
    // The property the whole "deterministic first" principle rests on. If this
    // ever fails, a rating is no longer reproducible.
    const a = JSON.stringify(resolveEngagementScope(base()));
    const b = JSON.stringify(resolveEngagementScope(base()));
    expect(a).toBe(b);
  });

  it("stamps the scope-rule version", () => {
    expect(resolveEngagementScope(base()).scope_rule_version).toBe(SCOPE_RULE_VERSION);
  });

  it("output order is stable regardless of input order", () => {
    const forward = resolveEngagementScope(base());
    const reversed = resolveEngagementScope(base({ requirements: [...CORPUS].reverse() }));
    expect(idsOf(forward)).toEqual(idsOf(reversed));
  });

  it("NO LLM is involved — the module has no async surface", () => {
    // A pure synchronous function cannot await a model. The type system says so;
    // this asserts it at runtime too, so a future refactor to async is a
    // deliberate, visible act rather than a quiet one.
    const result = resolveEngagementScope(base());
    expect(result).not.toBeInstanceOf(Promise);
  });
});

// ─── S1 tier baseline ───────────────────────────────────────────────────────

describe("scope resolution — S1 tier baseline", () => {
  it("tier 4 asks the core set only, at attest depth", () => {
    const r = resolveEngagementScope(base({ tier: "tier_4_low" }));
    expect(idsOf(r)).toEqual(["core-1", "core-2"]);
    expect(r.items.every((i) => i.depth === "attest")).toBe(true);
  });

  it("tier 1 takes EVERY requirement of every activated framework", () => {
    const r = resolveEngagementScope(base({ tier: "tier_1_critical" }));
    expect(idsOf(r)).toEqual([...CORPUS].map((c) => c.requirement_id).sort());
    // Including the one no context rule would ever pull in.
    expect(idsOf(r)).toContain("obscure-1");
  });

  it("tiers are strictly nested — a lower tier never asks more than a higher one", () => {
    const t4 = new Set(idsOf(resolveEngagementScope(base({ tier: "tier_4_low" }))));
    const t3 = new Set(idsOf(resolveEngagementScope(base({ tier: "tier_3_moderate" }))));
    const t2 = new Set(idsOf(resolveEngagementScope(base({ tier: "tier_2_high" }))));
    for (const id of t4) expect(t3.has(id), `t3 missing ${id}`).toBe(true);
    for (const id of t3) expect(t2.has(id), `t2 missing ${id}`).toBe(true);
  });
});

// ─── S2 context triggers ────────────────────────────────────────────────────

describe("scope resolution — S2 context triggers", () => {
  it("read_write access pulls in access control", () => {
    const r = resolveEngagementScope(
      base({ tier: "tier_4_low", inherent: { ...benign, access_level: "read_write" } })
    );
    expect(idsOf(r)).toContain("acl-1");
    expect(idsOf(r)).toContain("iam-1");
  });

  it("read_only access does NOT — the threshold is meaningful", () => {
    const r = resolveEngagementScope(
      base({ tier: "tier_4_low", inherent: { ...benign, access_level: "read_only" } })
    );
    expect(idsOf(r)).not.toContain("acl-1");
  });

  it("admin access additionally pulls in privileged-access controls", () => {
    const r = resolveEngagementScope(
      base({ tier: "tier_4_low", inherent: { ...benign, access_level: "admin" } })
    );
    expect(idsOf(r)).toContain("priv-1");
  });

  it("AI involvement pulls in AI governance", () => {
    const r = resolveEngagementScope(
      base({ tier: "tier_4_low", inherent: { ...benign, ai_involvement: "embedded" } })
    );
    expect(idsOf(r)).toContain("ai-1");
  });

  it("AI oversight requirements need BOTH involvement and consequential autonomy", () => {
    const involvedOnlyInput: InherentRiskInput = { ...benign, ai_involvement: "embedded", ai_autonomy: "human_in_the_loop" };
    const involvedOnly = resolveEngagementScope(base({ tier: "tier_4_low", inherent: involvedOnlyInput }));
    // Under 1.1.0 S5.ai.involvement activates the whole AI domain (including
    // human-oversight requirements); the S2 threshold is asserted on the RULE.
    const s2Ids = (r: ReturnType<typeof resolveEngagementScope>) =>
      r.items.flatMap((i) => i.reasons.filter((x) => x.rule_family === "S2").map((x) => x.rule_id));
    expect(s2Ids(involvedOnly)).not.toContain("S2.ai_autonomy");
    expect(
      idsOf(resolveEngagementScope(base({ tier: "tier_4_low", scopeRuleVersion: "1.0.0", inherent: involvedOnlyInput })))
    ).not.toContain("oversight-1");

    const autonomous = resolveEngagementScope(
      base({
        tier: "tier_4_low",
        inherent: {
          ...benign,
          ai_involvement: "core",
          ai_autonomy: "autonomous_consequential",
        },
      })
    );
    expect(idsOf(autonomous)).toContain("oversight-1");
  });

  it("multi-tenant hosting pulls in tenancy isolation", () => {
    const r = resolveEngagementScope(
      base({ tier: "tier_4_low", inherent: { ...benign, hosting_model: "multi_tenant_saas" } })
    );
    expect(idsOf(r)).toContain("tenancy-1");
  });

  it("a critical dependency pulls in resilience", () => {
    const r = resolveEngagementScope(
      base({ tier: "tier_4_low", inherent: { ...benign, operational_dependency: "critical" } })
    );
    expect(idsOf(r)).toContain("resil-1");
  });

  it("every trigger states a customer-readable rationale", () => {
    for (const t of CONTEXT_TRIGGERS) {
      expect(t.rationale.length, `${t.rule_id} rationale too thin`).toBeGreaterThan(30);
    }
  });
});

// ─── S3 regulatory derivation ───────────────────────────────────────────────

describe("scope resolution — S3 regulatory derivation", () => {
  it("an active obligation pulls in its mapped requirement, naming the obligation", () => {
    // Uses the SHIPPED obligation_mappings edges — zero new reference data for
    // the regulatory dimension.
    const r = resolveEngagementScope(
      base({
        tier: "tier_4_low",
        obligationEdges: [
          {
            obligation_id: "ob-1",
            obligation_title: "HIPAA Security Rule §164.308",
            requirement_id: "obscure-1",
          },
        ],
      })
    );
    expect(idsOf(r)).toContain("obscure-1");
    const item = r.items.find((i) => i.requirement_id === "obscure-1")!;
    expect(item.reasons.some((x) => x.rationale.includes("HIPAA Security Rule"))).toBe(true);
  });

  it("this is what makes two orgs get different questionnaires", () => {
    const healthcare = resolveEngagementScope(
      base({
        tier: "tier_4_low",
        obligationEdges: [
          { obligation_id: "ob-1", obligation_title: "HIPAA", requirement_id: "privacy-1" },
        ],
      })
    );
    const generic = resolveEngagementScope(base({ tier: "tier_4_low" }));
    expect(idsOf(healthcare)).toContain("privacy-1");
    expect(idsOf(generic)).not.toContain("privacy-1");
  });
});

// ─── Multi-reason provenance ────────────────────────────────────────────────

describe("scope resolution — every reason is recorded", () => {
  it("a requirement included by several rules keeps ALL of them", () => {
    // "Why is this here" often has more than one true answer, and keeping only
    // the first is a lie the customer can catch.
    const r = resolveEngagementScope(
      base({
        tier: "tier_2_high", // baseline includes access-control
        inherent: { ...benign, access_level: "admin" }, // S2 also includes it
        obligationEdges: [
          { obligation_id: "ob-1", obligation_title: "DORA", requirement_id: "acl-1" },
        ],
      })
    );
    const item = r.items.find((i) => i.requirement_id === "acl-1")!;
    const families = new Set(item.reasons.map((x) => x.rule_family));
    for (const f of ["S1", "S2", "S3"]) expect(families.has(f as never), f).toBe(true);
    // and under the 1.0.0 corpus those three are exactly the set
    const old = resolveEngagementScope(
      base({
        tier: "tier_2_high",
        scopeRuleVersion: "1.0.0",
        inherent: { ...benign, access_level: "admin" },
        obligationEdges: [{ obligation_id: "ob-1", obligation_title: "DORA", requirement_id: "acl-1" }],
      })
    );
    expect(new Set(old.items.find((i) => i.requirement_id === "acl-1")!.reasons.map((x) => x.rule_family))).toEqual(new Set(["S1", "S2", "S3"]));
  });

  it("every included item carries at least one reason", () => {
    const r = resolveEngagementScope(base({ tier: "tier_1_critical" }));
    for (const item of r.items) {
      expect(item.reasons.length, `${item.requirement_id} has no reason`).toBeGreaterThan(0);
      for (const reason of item.reasons) {
        expect(reason.rationale.length).toBeGreaterThan(10);
        expect(reason.rule_id.length).toBeGreaterThan(0);
      }
    }
  });

  it("every excluded requirement also states WHY it was excluded", () => {
    const r = resolveEngagementScope(base({ tier: "tier_4_low" }));
    expect(r.excluded.length).toBeGreaterThan(0);
    for (const e of r.excluded) {
      expect(e.rationale.length).toBeGreaterThan(20);
    }
  });
});

// ─── S4 assurance offset ────────────────────────────────────────────────────

describe("scope resolution — S4 assurance offset", () => {
  it("assurance REDUCES depth and never removes the requirement", () => {
    // An independent report is evidence, not a substitute for asking.
    const r = resolveEngagementScope(
      base({ tier: "tier_4_low", assuranceCoveredRequirementIds: ["core-1"] })
    );
    expect(idsOf(r)).toContain("core-1");
    expect(r.items.find((i) => i.requirement_id === "core-1")!.depth).toBe("confirm");
  });

  it("the offset is recorded as a reason, not applied invisibly", () => {
    const r = resolveEngagementScope(
      base({ tier: "tier_4_low", assuranceCoveredRequirementIds: ["core-1"] })
    );
    const item = r.items.find((i) => i.requirement_id === "core-1")!;
    expect(item.reasons.some((x) => x.rule_family === "S4")).toBe(true);
  });
});

// ─── Caps: never silent ─────────────────────────────────────────────────────

describe("scope resolution — no silent truncation", () => {
  // 40 `core` requirements are 40 S1.baseline items — i.e. all floor. Under the
  // #922 ruling the nominal target does not delete a floor, so nothing is
  // dropped and the OVERAGE is what gets recorded.
  const manyCore = Array.from({ length: 40 }, (_, i) => req(`core-${i}`, ["core"]));

  it("a floor larger than the nominal target is KEPT, and the overage is recorded", () => {
    const r = resolveEngagementScope(base({ tier: "tier_4_low", requirements: manyCore }));

    expect(r.items).toHaveLength(40);
    expect(r.truncated).toBeNull();
    expect(r.composition).toEqual({
      nominal_target: 15,
      mandatory: 40,
      discretionary: 0,
      total: 40,
      mandatory_overage: 25,
    });
  });

  it("the 1.0.0 corpus keeps its frozen truncation behaviour, unchanged", () => {
    // Deliberately NOT fixed under 1.0.0: two of the 21 golden cases truncate,
    // and the defect cannot arise there (no S5, so nothing crowds security out).
    const r = resolveEngagementScope({
      ...base({ tier: "tier_4_low", requirements: manyCore }),
      scopeRuleVersion: "1.0.0",
    });
    expect(r.items).toHaveLength(15);
    expect(r.truncated!.cap).toBe(15);
    expect(r.truncated!.dropped_requirement_ids).toHaveLength(25);
    expect("composition" in r).toBe(false);
  });

  it("discretionary truncation is deterministic — same inputs, same drops", () => {
    // A corpus where the floor fits but discretionary items do not: 10 core
    // (floor) plus 30 privacy requirements activated by a declared fact.
    const corpus = [
      ...Array.from({ length: 10 }, (_, i) => req(`core-${i}`, ["core"])),
      ...Array.from({ length: 30 }, (_, i) => req(`privacy-${i}`, ["privacy"])),
    ];
    const facts = resolveFacts([...factsFromInherent(benign), fact("data.personal_data", true)]);
    const a = resolveEngagementScope(base({ tier: "tier_4_low", requirements: corpus, facts }));
    const b = resolveEngagementScope(
      base({ tier: "tier_4_low", requirements: [...corpus].reverse(), facts })
    );

    expect(a.truncated).not.toBeNull();
    expect(a.truncated!.dropped_requirement_ids).toEqual(b.truncated!.dropped_requirement_ids);
    expect(a.items.map((i) => i.requirement_id)).toEqual(b.items.map((i) => i.requirement_id));
    // The floor took its 10, the remaining 5 slots went to privacy.
    expect(a.composition).toEqual({
      nominal_target: 15,
      mandatory: 10,
      discretionary: 5,
      total: 15,
      mandatory_overage: 0,
    });
  });

  it("under the target, truncated is null rather than an empty object", () => {
    expect(resolveEngagementScope(base()).truncated).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #922 — the SecureLogic security baseline is a protected assessment floor
// ═══════════════════════════════════════════════════════════════════════════

describe("#922 — the security baseline survives truncation at tier_4_low", () => {
  /** A corpus big enough in every non-security domain to crowd security out. */
  const CROWDED: ScopableRequirement[] = [
    ...Array.from({ length: 6 }, (_, i) => req(`core-${i}`, ["core"])),
    ...Array.from({ length: 20 }, (_, i) => req(`privacy-${i}`, ["privacy"])),
    ...Array.from({ length: 20 }, (_, i) => req(`ai-${i}`, ["ai-governance"])),
    ...Array.from({ length: 20 }, (_, i) => req(`sub-${i}`, ["subprocessor"])),
  ];

  const withFacts = (extra: Array<ReturnType<typeof fact>>) =>
    resolveEngagementScope(
      base({
        tier: "tier_4_low",
        requirements: CROWDED,
        facts: resolveFacts([...factsFromInherent(benign), ...extra]),
      })
    );

  /** Items the security baseline is responsible for. */
  const securityFloor = (r: ReturnType<typeof resolveEngagementScope>) =>
    r.items.filter((i) => i.reasons.some((x) => x.rule_id === "S5.security.baseline"));

  const CASES: Array<[string, Array<ReturnType<typeof fact>>, string[]]> = [
    ["Security only", [], []],
    ["Security + Privacy", [fact("data.personal_data", true)], ["privacy-"]],
    ["Security + AI", [fact("ai.uses_ai", true)], ["ai-"]],
    [
      "Security + Privacy + AI",
      [fact("data.personal_data", true), fact("ai.uses_ai", true)],
      ["privacy-", "ai-"],
    ],
    ["Security + Nth Party", [fact("ai.third_party_models", true)], ["sub-"]],
    [
      "Security + Privacy + AI + Nth Party",
      [
        fact("data.personal_data", true),
        fact("ai.uses_ai", true),
        fact("ai.third_party_models", true),
      ],
      ["privacy-", "ai-", "sub-"],
    ],
  ];

  for (const [name, facts, expectPrefixes] of CASES) {
    describe(name, () => {
      const r = withFacts(facts);

      it("keeps every security-baseline item — the floor cannot disappear", () => {
        // The regression in one assertion: before the ruling this was 0 for
        // every case that activated another domain.
        expect(securityFloor(r).length).toBeGreaterThan(0);
        expect(r.items.filter((i) => i.domain === "security").length).toBeGreaterThan(0);
      });

      it("considers the requirements its facts call for — kept, or visibly dropped", () => {
        // A rule firing and a domain surviving truncation are different things.
        // On a crowded tier-4 corpus a DISCRETIONARY domain can activate and
        // still receive zero items once the floor has taken its room.
        //
        // Note what this assertion had to work around: `reasons` live on ITEMS,
        // so once every item a rule contributed is truncated, the resolution no
        // longer records that the rule fired at all. Activation is therefore
        // proven here the only way it can be — the requirements were either
        // kept or named in `dropped_requirement_ids`. That gap is real and is
        // reported rather than papered over; see the starvation test below.
        const seen = new Set([
          ...r.items.map((i) => i.requirement_id),
          ...(r.truncated?.dropped_requirement_ids ?? []),
        ]);
        for (const prefix of expectPrefixes) {
          expect([...seen].some((id) => id.startsWith(prefix))).toBe(true);
        }
      });

      it("satisfies the floor before any discretionary item is kept", () => {
        const floorCount = r.items.filter((i) =>
          i.reasons.some((x) => x.rule_id === "S1.baseline" || x.rule_id === "S5.security.baseline")
        ).length;
        expect(r.composition!.mandatory).toBe(floorCount);
        expect(r.composition!.total).toBe(r.items.length);
        expect(r.composition!.mandatory + r.composition!.discretionary).toBe(r.items.length);
      });

      it("never drops a floor item, whatever it drops", () => {
        const droppedIds = new Set(r.truncated?.dropped_requirement_ids ?? []);
        const floorIds = r.items
          .filter((i) =>
            i.reasons.some(
              (x) => x.rule_id === "S1.baseline" || x.rule_id === "S5.security.baseline"
            )
          )
          .map((i) => i.requirement_id);
        for (const id of floorIds) expect(droppedIds.has(id)).toBe(false);
      });

      it("reports the nominal target, and never claims a target it exceeded silently", () => {
        expect(r.composition!.nominal_target).toBe(15);
        if (r.composition!.total > 15) {
          expect(r.composition!.mandatory_overage).toBeGreaterThan(0);
        } else {
          expect(r.composition!.mandatory_overage).toBe(0);
        }
      });
    });
  }

  it("a floor that alone exceeds the nominal target is preserved whole", () => {
    const bigFloor = [
      ...Array.from({ length: 25 }, (_, i) => req(`core-${i}`, ["core"])),
      ...Array.from({ length: 20 }, (_, i) => req(`privacy-${i}`, ["privacy"])),
    ];
    const r = resolveEngagementScope(
      base({
        tier: "tier_4_low",
        requirements: bigFloor,
        facts: resolveFacts([...factsFromInherent(benign), fact("data.personal_data", true)]),
      })
    );

    expect(r.composition!.mandatory).toBe(25);
    expect(r.composition!.mandatory_overage).toBe(10);
    expect(r.composition!.discretionary).toBe(0);
    expect(r.items).toHaveLength(25);
    // Every privacy requirement was dropped — correctly, and visibly.
    expect(r.truncated!.dropped_requirement_ids).toHaveLength(20);
    expect(r.items.every((i) => i.requirement_id.startsWith("core-"))).toBe(true);
  });

  it("a DISCRETIONARY domain can still be starved by the target — visibly, not silently", () => {
    // The honest limit of this fix. #922 protects the SecureLogic floor; it does
    // not promise every activated domain a slot. Here privacy and nth-party
    // activate and lose their slots to AI on a deterministic id ordering. The
    // loss is recorded in `truncated`, and `composition` shows the arithmetic.
    // Whether discretionary domains deserve a floor of their own is the
    // assurance-need question, not a cap question.
    const r = withFacts([
      fact("data.personal_data", true),
      fact("ai.uses_ai", true),
      fact("ai.third_party_models", true),
    ]);
    // Privacy activated — its requirements were considered — yet none survived.
    const dropped = new Set(r.truncated?.dropped_requirement_ids ?? []);
    expect([...dropped].some((id) => id.startsWith("privacy-"))).toBe(true);
    expect(r.items.some((i) => i.domain === "privacy")).toBe(false);
    expect(r.truncated).not.toBeNull();
    expect(r.truncated!.dropped_requirement_ids.length).toBeGreaterThan(0);
    expect(r.composition!.discretionary).toBe(15 - r.composition!.mandatory);
    // Security, being the floor, is untouched by that competition.
    expect(r.items.filter((i) => i.domain === "security").length).toBe(6);
  });

  it("the regression itself: a crowded corpus no longer yields zero security items", () => {
    const r = withFacts([
      fact("data.personal_data", true),
      fact("ai.uses_ai", true),
      fact("ai.third_party_models", true),
    ]);
    const securityItems = r.items.filter((i) => i.domain === "security");
    expect(securityItems.length).toBe(6); // all six core requirements survive
    expect(r.composition!.mandatory).toBe(6);
  });
});

// ─── AI boundary ────────────────────────────────────────────────────────────

describe("scope resolution — the AI boundary", () => {
  it("every deterministically-resolved item is marked as such", () => {
    // AI may PROPOSE extra items, but they arrive as source:'ai_suggested' and
    // are invisible to the vendor until a human accepts them. Nothing this
    // resolver produces may be mistaken for a model's opinion.
    const r = resolveEngagementScope(base({ tier: "tier_1_critical" }));
    for (const item of r.items) {
      expect(item.source).toBe("deterministic");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// VA-Q2 P1 — S5 domain activation, the version gate, and the fact surface
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DOMAIN_ACTIVATION,
  scopeVersionRunsS5,
  type ScopeItem,
} from "../lib/vendorRisk/scopeResolver.js";
import { factsFromInherent, resolveFacts } from "../lib/vendorRisk/factResolver.js";
import { FACT_KEYS, FACT_REGISTRY, type FactRow } from "../lib/vendorRisk/factRegistry.js";
import { ASSESSMENT_DOMAINS } from "../lib/vendorRisk/requirementDomain.js";
import { GOLDEN_CASES } from "./fixtures/scopeResolverGoldenCases.js";

const GOLDEN = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/scopeResolver-1.0.0.golden.json", import.meta.url)), "utf8")
) as Record<string, unknown>;

// ─── 1.0.0 golden equivalence ───────────────────────────────────────────────

describe("VA-Q2 — engagements stamped 1.0.0 re-resolve BYTE-IDENTICALLY", () => {
  it("the golden corpus covers every case name exactly once", () => {
    expect(Object.keys(GOLDEN).sort()).toEqual(GOLDEN_CASES.map((c) => c.name).sort());
    expect(GOLDEN_CASES.length).toBe(21);
  });

  for (const c of GOLDEN_CASES) {
    it(`golden: ${c.name}`, () => {
      const r = resolveEngagementScope({ ...c.input, scopeRuleVersion: "1.0.0" });
      expect(JSON.stringify(r)).toBe(JSON.stringify(GOLDEN[c.name]));
      // No 1.1.0 artefacts leak into a 1.0.0 resolution.
      expect(r.scope_rule_version).toBe("1.0.0");
      for (const item of r.items) {
        expect("domain" in item).toBe(false);
        expect(item.reasons.some((x) => x.rule_family === "S5")).toBe(false);
      }
    });
  }

  it("the golden JSON itself was produced under 1.0.0 and carries no S5 or domain", () => {
    const text = JSON.stringify(GOLDEN);
    expect(text).not.toContain('"S5"');
    expect(text).not.toContain('"domain"');
    expect(text.match(/"scope_rule_version": ?"1\.0\.0"/g)?.length).toBe(21);
  });

  it("a malformed or pre-semver stamp never runs S5 (fail toward the old corpus)", () => {
    expect(scopeVersionRunsS5("1.0.0")).toBe(false);
    expect(scopeVersionRunsS5("0.9.9")).toBe(false);
    expect(scopeVersionRunsS5("")).toBe(false);
    expect(scopeVersionRunsS5("garbage")).toBe(false);
    expect(scopeVersionRunsS5("1.1.0")).toBe(true);
    expect(scopeVersionRunsS5("1.2.0")).toBe(true);
    expect(scopeVersionRunsS5("2.0.0")).toBe(true);
    expect(scopeVersionRunsS5(SCOPE_RULE_VERSION)).toBe(true);
  });

  it("the current constant is 1.1.0 and a new engagement defaults to it", () => {
    expect(SCOPE_RULE_VERSION).toBe("1.1.0");
    expect(resolveEngagementScope(base()).scope_rule_version).toBe("1.1.0");
  });
});

// ─── The directive's two worked examples (VA-Q0 §6.3, §17 Q2) ───────────────

/** Fact rows by ORIGIN; the trust class follows the allowed-pair table (VA-Q2 P3). */
const SOURCE_FOR: Record<string, string> = {
  intake: "intake",
  vendor_profile: "system_derived",
  ai_system_dependency: "system_derived",
  profile_default: "system_derived",
  derived: "system_derived",
  vendor_answer: "vendor_response",
};
const fact = (fact_key: string, value: unknown, origin: FactRow["origin"] = "intake"): FactRow => ({
  fact_key,
  value,
  source: SOURCE_FOR[origin] ?? origin,
  origin,
});

/** A corpus with at least one requirement per domain tag group, plus filler. */
const DOMAIN_CORPUS: ScopableRequirement[] = [
  ...CORPUS,
  req("bcp-1", ["business-continuity"]),
  req("sub-1", ["subprocessor"]),
  req("model-1", ["model-risk"]),
  req("retention-1", ["retention"]),
  req("enc-1", ["encryption"]),
];

const s5RuleIds = (r: ReturnType<typeof resolveEngagementScope>) =>
  new Set(r.items.flatMap((i) => i.reasons.filter((x) => x.rule_family === "S5").map((x) => x.rule_id)));
const domainsOf = (r: ReturnType<typeof resolveEngagementScope>) => new Set(r.items.map((i) => i.domain));

// ═══════════════════════════════════════════════════════════════════════════
// VA-Q2 P4 — S2 triggers that read NON-CORE facts
// ═══════════════════════════════════════════════════════════════════════════

describe("VA-Q2 P4 — S2 reads facts", () => {
  const FACT_CORPUS: ScopableRequirement[] = [
    ...DOMAIN_CORPUS,
    req("xborder-1", ["cross-border"]),
    req("provider-1", ["model-provider"]),
  ];

  const withFact = (key: string, value: unknown, over: Partial<ScopeResolverInput> = {}) =>
    resolveEngagementScope(
      base({
        tier: "tier_1_critical", // `*` baseline: nothing is excluded for tag reasons
        requirements: FACT_CORPUS,
        facts: resolveFacts([...factsFromInherent(benign), fact(key as never, value as never)]),
        ...over,
      })
    );

  const reasonIds = (r: ReturnType<typeof resolveEngagementScope>, id: string) =>
    r.items.find((i) => i.requirement_id === id)?.reasons.map((x) => x.rule_id) ?? [];

  it("S2.ai_prompts fires on ai.customer_data_in_prompts and reaches privacy AND AI tags", () => {
    const r = withFact("ai.customer_data_in_prompts", true);
    expect(reasonIds(r, "privacy-1")).toContain("S2.ai_prompts");
    expect(reasonIds(r, "ai-1")).toContain("S2.ai_prompts");
    expect(reasonIds(r, "provider-1")).toContain("S2.ai_prompts");
    // Recorded as an S2 rule, not smuggled in as S5.
    const reason = r.items
      .flatMap((i) => i.reasons)
      .find((x) => x.rule_id === "S2.ai_prompts");
    expect(reason!.rule_family).toBe("S2");
  });

  it("S2.cross_border fires on data.cross_border", () => {
    const r = withFact("data.cross_border", true);
    expect(reasonIds(r, "xborder-1")).toContain("S2.cross_border");
    expect(reasonIds(r, "data-1")).toContain("S2.cross_border");
  });

  it("S2.subprocessors fires on nth.subprocessors_declared", () => {
    const r = withFact("nth.subprocessors_declared", true);
    expect(reasonIds(r, "supply-1")).toContain("S2.subprocessors");
    expect(reasonIds(r, "sub-1")).toContain("S2.subprocessors");
  });

  it("a false fact does not fire the trigger", () => {
    const r = withFact("data.cross_border", false);
    expect(reasonIds(r, "xborder-1")).not.toContain("S2.cross_border");
  });

  it("an ABSENT fact does not fire the trigger", () => {
    const r = resolveEngagementScope(
      base({ tier: "tier_1_critical", requirements: FACT_CORPUS })
    );
    for (const id of ["S2.ai_prompts", "S2.cross_border", "S2.subprocessors"]) {
      expect(r.items.flatMap((i) => i.reasons).some((x) => x.rule_id === id)).toBe(false);
    }
  });

  it("reads ONLY accepted rows — a proposed fact is not a fact", () => {
    // Inherited from resolveFacts rather than re-implemented; asserted so the
    // inheritance cannot be quietly broken.
    const proposed = resolveFacts([
      ...factsFromInherent(benign),
      { fact_key: "data.cross_border", value: true, source: "intake", origin: "intake", status: "proposed" } as never,
    ]);
    const r = resolveEngagementScope(
      base({ tier: "tier_1_critical", requirements: FACT_CORPUS, facts: proposed })
    );
    expect(reasonIds(r, "xborder-1")).not.toContain("S2.cross_border");
  });

  it("does NOT fire under 1.0.0 — pre-Q2 engagements cannot move", () => {
    const r = resolveEngagementScope({
      ...base({
        tier: "tier_1_critical",
        requirements: FACT_CORPUS,
        facts: resolveFacts([...factsFromInherent(benign), fact("data.cross_border", true)]),
      }),
      scopeRuleVersion: "1.0.0",
    });
    expect(r.items.flatMap((i) => i.reasons).some((x) => x.rule_id === "S2.cross_border")).toBe(false);
  });

  it("the domain an S2-fact requirement is asked under still comes from its TAGS", () => {
    const r = withFact("ai.customer_data_in_prompts", true);
    // privacy-1 carries `privacy`; provider-1 carries `model-provider` (an AI tag).
    expect(r.items.find((i) => i.requirement_id === "privacy-1")!.domain).toBe("privacy");
    expect(r.items.find((i) => i.requirement_id === "provider-1")!.domain).toBe("ai");
  });
});

describe("VA-Q2 — directive example 1: LLM + customer PII", () => {
  const facts = resolveFacts([
    ...factsFromInherent(benign),
    fact("ai.uses_ai", true),
    fact("ai.third_party_models", true),
    fact("ai.customer_data_in_prompts", true),
    fact("data.personal_data", true),
  ]);
  const r = resolveEngagementScope(base({ tier: "tier_3_moderate", requirements: DOMAIN_CORPUS, facts }));

  it("activates Security + Privacy + AI + Nth party", () => {
    expect(domainsOf(r)).toEqual(new Set(["security", "privacy", "ai", "nth_party"]));
  });

  it("with four DISTINCT S5 rule_ids — one per activating clause, each recorded as a reason", () => {
    const ids = s5RuleIds(r);
    expect(ids.has("S5.security.baseline")).toBe(true);
    expect(ids.has("S5.privacy.personal_data")).toBe(true);
    expect(ids.has("S5.ai.declared")).toBe(true);
    expect(ids.has("S5.nth.third_party_models")).toBe(true);
    expect(ids.size).toBeGreaterThanOrEqual(4);
    // one per activated domain, at least
    const byDomain = new Set([...ids].map((id) => id.split(".")[1]));
    expect(byDomain).toEqual(new Set(["security", "privacy", "ai", "nth"]));
  });

  it("S5 WIDENED beyond what the 13 inputs alone would ask", () => {
    const withoutFacts = resolveEngagementScope(base({ tier: "tier_3_moderate", requirements: DOMAIN_CORPUS }));
    expect(idsOf(withoutFacts)).not.toContain("ai-1");
    expect(idsOf(withoutFacts)).not.toContain("sub-1");
    expect(idsOf(r)).toContain("ai-1");
    expect(idsOf(r)).toContain("model-1");
    expect(idsOf(r)).toContain("sub-1");
    expect(idsOf(r)).toContain("privacy-1");
    expect(idsOf(r)).toContain("retention-1");
  });

  it("compliance did NOT activate — no obligation edge, no compliance domain", () => {
    expect(domainsOf(r).has("compliance")).toBe(false);
  });
});

describe("VA-Q2 — directive example 2: no access, no personal data, no AI, tier 4", () => {
  const facts = resolveFacts([
    ...factsFromInherent({ ...benign, access_level: "none" }),
    fact("data.personal_data", false),
    fact("ai.uses_ai", false),
  ]);
  const r = resolveEngagementScope(base({ tier: "tier_4_low", requirements: DOMAIN_CORPUS, facts }));

  it("yields Security at attest depth only", () => {
    expect(r.items.length).toBeGreaterThan(0);
    expect(domainsOf(r)).toEqual(new Set(["security"]));
    expect(r.items.every((i) => i.depth === "attest")).toBe(true);
  });

  it("≤ 15 items, nothing truncated", () => {
    expect(r.items.length).toBeLessThanOrEqual(15);
    expect(r.truncated).toBeNull();
  });

  it("the only S5 rule that fired is the security baseline", () => {
    expect(s5RuleIds(r)).toEqual(new Set(["S5.security.baseline"]));
  });

  it("asks exactly what 1.0.0 asked (S5.security never widens the baseline)", () => {
    const old = resolveEngagementScope(base({ tier: "tier_4_low", requirements: DOMAIN_CORPUS, scopeRuleVersion: "1.0.0" }));
    expect(idsOf(r)).toEqual(idsOf(old));
  });
});

// ─── Determinism over 100 runs ──────────────────────────────────────────────

describe("VA-Q2 — same facts → identical ordered item list across 100 runs", () => {
  it("100 runs, one byte string", () => {
    const rows = [
      ...factsFromInherent({ ...benign, operational_dependency: "high", data_sensitivity: "confidential" }),
      fact("ai.uses_ai", true, "ai_system_dependency"),
      fact("ai.third_party_models", true, "vendor_answer"),
      fact("data.personal_data", true),
      fact("nth.subprocessors_declared", true, "vendor_answer"),
    ];
    const first = JSON.stringify(resolveEngagementScope(base({ tier: "tier_2_high", requirements: DOMAIN_CORPUS, facts: resolveFacts(rows) })));
    const firstItems = JSON.stringify(JSON.parse(first).items);
    for (let i = 0; i < 100; i++) {
      const shuffled = [...rows].sort(() => (i % 2 === 0 ? 1 : -1));
      const again = JSON.stringify(resolveEngagementScope(base({ tier: "tier_2_high", requirements: DOMAIN_CORPUS, facts: resolveFacts(shuffled) })));
      expect(again).toBe(first);
      // and the ORDERED item list is independent of requirement input order too
      // (`excluded` follows input order by 1.0.0 design — unchanged here)
      const reversed = resolveEngagementScope(base({ tier: "tier_2_high", requirements: [...DOMAIN_CORPUS].reverse(), facts: resolveFacts(shuffled) }));
      expect(JSON.stringify(reversed.items)).toBe(firstItems);
    }
  });
});

// ─── S5 invariants ──────────────────────────────────────────────────────────

describe("VA-Q2 — S5 only ever ADDS (ADR-0013 R4)", () => {
  it("no activation rule has an exclude effect — by shape", () => {
    for (const rule of DOMAIN_ACTIVATION) {
      expect(Object.keys(rule).sort()).toEqual(["applies", "depth", "domain", "rationale", "rule_id"]);
      expect(rule.domain).not.toBe("compliance");
      expect(ASSESSMENT_DOMAINS).toContain(rule.domain);
    }
  });

  it("rule_ids are unique, S5-prefixed, and name their domain", () => {
    const ids = DOMAIN_ACTIVATION.map((r) => r.rule_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of DOMAIN_ACTIVATION) {
      expect(r.rule_id.startsWith("S5.")).toBe(true);
      const seg = r.rule_id.split(".")[1];
      expect(seg === r.domain || (seg === "nth" && r.domain === "nth_party")).toBe(true);
    }
  });

  it("every fact an S5 rule reads is a registered key", () => {
    // Rules read facts through typed readers, so an unregistered key would be a
    // compile error; this asserts the keys the table names actually exist.
    for (const k of ["data.personal_data", "core.data_sensitivity", "policy.privacy_obligations_active", "ai.customer_data_in_prompts", "core.ai_involvement", "ai.uses_ai", "core.operational_dependency", "core.recoverability", "core.business_criticality", "core.fourth_party_exposure", "nth.subprocessors_declared", "ai.third_party_models"]) {
      expect(FACT_KEYS).toContain(k);
    }
  });

  it("1.1.0 is a SUPERSET of 1.0.0 for every golden case — S5 never removes an item", () => {
    for (const c of GOLDEN_CASES) {
      const old = new Set(idsOf(resolveEngagementScope({ ...c.input, scopeRuleVersion: "1.0.0" })));
      const cur = resolveEngagementScope({ ...c.input, scopeRuleVersion: "1.1.0" });
      // (under the cap the superset must hold; over the cap the drop list is recorded)
      if (cur.truncated === null) for (const id of old) expect(idsOf(cur), `${c.name} lost ${id}`).toContain(id);
      for (const item of cur.items) expect(ASSESSMENT_DOMAINS).toContain(item.domain);
    }
  });

  it("a vendor answer widens the scope and never narrows it", () => {
    const intakeOnly = resolveEngagementScope(base({ requirements: DOMAIN_CORPUS, facts: resolveFacts([...factsFromInherent(benign), fact("nth.subprocessors_declared", true)]) }));
    const vendorSaysNo = resolveEngagementScope(base({ requirements: DOMAIN_CORPUS, facts: resolveFacts([...factsFromInherent(benign), fact("nth.subprocessors_declared", true), fact("nth.subprocessors_declared", false, "vendor_answer")]) }));
    const vendorSaysYes = resolveEngagementScope(base({ requirements: DOMAIN_CORPUS, facts: resolveFacts([...factsFromInherent(benign), fact("nth.subprocessors_declared", false), fact("nth.subprocessors_declared", true, "vendor_answer")]) }));
    expect(idsOf(vendorSaysNo)).toEqual(idsOf(intakeOnly));
    expect(idsOf(vendorSaysYes)).toContain("sub-1");
    expect(idsOf(vendorSaysYes)).toContain("supply-1");
  });
});

describe("VA-Q2 — domains", () => {
  it("compliance is stamped ONLY on requirements reached via S3", () => {
    const r = resolveEngagementScope(
      base({
        tier: "tier_4_low",
        requirements: DOMAIN_CORPUS,
        obligationEdges: [{ obligation_id: "ob-1", obligation_title: "GDPR Art. 28", requirement_id: "privacy-1" }],
      })
    );
    const viaS3 = r.items.find((i) => i.requirement_id === "privacy-1")!;
    expect(viaS3.domain).toBe("compliance");
    for (const item of r.items) {
      const reachedViaS3 = item.reasons.some((x) => x.rule_family === "S3");
      expect(item.domain === "compliance", item.requirement_id).toBe(reachedViaS3);
    }
  });

  it("every 1.1.0 item carries a domain from the closed set; every S5 reason is S5", () => {
    const r = resolveEngagementScope(base({ tier: "tier_1_critical", requirements: DOMAIN_CORPUS }));
    for (const item of r.items) {
      expect(ASSESSMENT_DOMAINS).toContain(item.domain);
      for (const x of item.reasons) if (x.rule_id.startsWith("S5.")) expect(x.rule_family).toBe("S5");
    }
  });

  it("the security rationale is a plain baseline statement (tier 4 stays attest)", () => {
    const r = resolveEngagementScope(base({ tier: "tier_4_low", requirements: DOMAIN_CORPUS }));
    expect(r.items.every((i) => i.domain === "security" && i.depth === "attest")).toBe(true);
  });
});

// ─── T-13: no fact VALUE ever reaches vendor-visible text ───────────────────

describe("VA-Q2 — S5 rationale never interpolates a fact value (T-13)", () => {
  it("every rationale is a static string longer than 30 chars", () => {
    for (const rule of DOMAIN_ACTIVATION) {
      expect(typeof rule.rationale).toBe("string");
      expect(rule.rationale.length, rule.rule_id).toBeGreaterThan(30);
    }
  });

  it("no rationale contains any vocabulary value of any registered fact", () => {
    const values = new Set<string>();
    for (const k of FACT_KEYS) {
      const s = FACT_REGISTRY[k] as { values?: readonly string[]; ranked?: readonly string[] };
      for (const v of [...(s.values ?? []), ...(s.ranked ?? [])]) if (v.length > 3 && v.includes("_")) values.add(v);
    }
    expect(values.size).toBeGreaterThan(5);
    for (const rule of DOMAIN_ACTIVATION) for (const v of values) expect(rule.rationale, `${rule.rule_id} leaks ${v}`).not.toContain(v);
  });

  it("a resolution over distinctive facts carries no fact value in any reason", () => {
    const r = resolveEngagementScope(
      base({
        tier: "tier_1_critical",
        requirements: DOMAIN_CORPUS,
        facts: resolveFacts([
          ...factsFromInherent({ ...benign, concentration: "single_point_of_failure", ai_autonomy: "autonomous_consequential" }),
          fact("ai.model_providers", ["ZZ-Distinctive-Provider-Ltd"]),
          fact("data.jurisdictions", ["ZZ"]),
        ]),
      })
    );
    const text = JSON.stringify(r.items.map((i: ScopeItem) => i.reasons));
    expect(text).not.toContain("ZZ-Distinctive-Provider-Ltd");
    expect(text).not.toContain("single_point_of_failure");
    expect(text).not.toContain("autonomous_consequential");
  });
});

// ─── Purity: the resolver imports nothing from infra ────────────────────────

describe("VA-Q2 — the resolver stays pure (ADR-0013 R2)", () => {
  it("scopeResolver, factRegistry, factResolver and requirementDomain import nothing from infra/ or routes/", () => {
    for (const f of ["scopeResolver", "factRegistry", "factResolver", "requirementDomain"]) {
      const src = readFileSync(fileURLToPath(new URL(`../lib/vendorRisk/${f}.ts`, import.meta.url)), "utf8");
      expect(src, f).not.toMatch(/from "\.\.\/(infra|routes|db)/);
      expect(src, f).not.toMatch(/\bpg\b\.query|import .*pg\b/);
      expect(src, f).not.toMatch(/\basync\b/);
    }
  });
});

// ─── VA-Q2 P2: the domain stamp ─────────────────────────────────────────────

describe("VA-Q2 P2 — every 1.1.0 item is stamped with a domain; 1.0.0 stamps none", () => {
  const withObligation = base({
    tier: "tier_2_high",
    requirements: [...CORPUS, req("obl-1", ["privacy"])],
    obligationEdges: [{ obligation_id: "o-1", obligation_title: "GDPR", requirement_id: "obl-1" }],
  });

  it("under the current corpus (1.1.0) every item carries a domain from the closed set", () => {
    const r = resolveEngagementScope(withObligation);
    expect(r.scope_rule_version).toBe("1.1.0");
    expect(r.items.length).toBeGreaterThan(0);
    for (const item of r.items) {
      expect(ASSESSMENT_DOMAINS as readonly string[], item.requirement_id).toContain(item.domain);
    }
  });

  it("the stamp is the versioned rule: tag → domain, security the floor, compliance iff reached via S3", () => {
    const r = resolveEngagementScope(withObligation);
    const byId = new Map(r.items.map((i) => [i.requirement_id, i]));
    expect(byId.get("core-1")?.domain).toBe("security");
    expect(byId.get("acl-1")?.domain).toBe("security");
    expect(byId.get("data-1")?.domain).toBe("privacy");
    expect(byId.get("resil-1")?.domain).toBe("resilience");
    // Same tag as privacy-1, but reached through an obligation edge → compliance.
    expect(byId.get("obl-1")?.domain).toBe("compliance");
    expect(byId.get("obl-1")?.reasons.some((x) => x.rule_family === "S3")).toBe(true);
  });

  it("under a 1.0.0 stamp NO item has a domain key at all — the route then writes NULL", () => {
    const r = resolveEngagementScope({ ...withObligation, scopeRuleVersion: "1.0.0" });
    expect(r.scope_rule_version).toBe("1.0.0");
    expect(r.items.length).toBeGreaterThan(0);
    for (const item of r.items) {
      expect(Object.hasOwn(item, "domain"), item.requirement_id).toBe(false);
      expect(item.domain ?? null).toBeNull();
    }
  });

  it("a curated-only P2 tag activates its domain through S5 and stamps it", () => {
    const corpus = [...CORPUS, req("dsr-1", ["data-subject-rights"]), req("mp-1", ["model-provider"])];
    const facts = resolveFacts([
      ...factsFromInherent(benign),
      fact("data.personal_data", true),
      fact("ai.uses_ai", true),
    ]);
    const r = resolveEngagementScope(base({ tier: "tier_4_low", requirements: corpus, facts }));
    const byId = new Map(r.items.map((i) => [i.requirement_id, i]));
    expect(byId.get("dsr-1")?.domain).toBe("privacy");
    expect(byId.get("mp-1")?.domain).toBe("ai");
    // and the same corpus under 1.0.0 never sees the S5-only items
    const old = resolveEngagementScope(base({ tier: "tier_4_low", requirements: corpus, facts, scopeRuleVersion: "1.0.0" }));
    expect(idsOf(old)).not.toContain("dsr-1");
    expect(idsOf(old)).not.toContain("mp-1");
  });
});
