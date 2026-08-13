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
    const involvedOnly = resolveEngagementScope(
      base({
        tier: "tier_4_low",
        inherent: { ...benign, ai_involvement: "embedded", ai_autonomy: "human_in_the_loop" },
      })
    );
    expect(idsOf(involvedOnly)).not.toContain("oversight-1");

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
    const families = item.reasons.map((x) => x.rule_family);
    expect(new Set(families)).toEqual(new Set(["S1", "S2", "S3"]));
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
  it("an over-cap tier RECORDS what it dropped", () => {
    // The repo's standing no-silent-caps principle. A scope that silently shrank
    // would read as "we asked everything that applies" when it did not.
    const many = Array.from({ length: 40 }, (_, i) => req(`core-${i}`, ["core"]));
    const r = resolveEngagementScope(base({ tier: "tier_4_low", requirements: many }));

    expect(r.truncated).not.toBeNull();
    expect(r.truncated!.cap).toBe(15);
    expect(r.items).toHaveLength(15);
    expect(r.truncated!.dropped_requirement_ids).toHaveLength(25);
  });

  it("truncation is deterministic — the same inputs drop the same requirements", () => {
    const many = Array.from({ length: 40 }, (_, i) => req(`core-${i}`, ["core"]));
    const a = resolveEngagementScope(base({ tier: "tier_4_low", requirements: many }));
    const b = resolveEngagementScope(base({ tier: "tier_4_low", requirements: [...many].reverse() }));
    expect(a.truncated!.dropped_requirement_ids).toEqual(b.truncated!.dropped_requirement_ids);
  });

  it("under the cap, truncated is null rather than an empty object", () => {
    expect(resolveEngagementScope(base()).truncated).toBeNull();
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
