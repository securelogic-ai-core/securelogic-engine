/**
 * scopeResolverGoldenCases.ts — the frozen 1.0.0 scoping corpus (VA-Q2 P1).
 *
 * Every case here was run through the S1–S4 resolver as it stood at
 * `develop` @ 2c104dfe (SCOPE_RULE_VERSION 1.0.0) and the outputs were written
 * to `scopeResolver-1.0.0.golden.json`. The golden test replays the same cases
 * with `scopeRuleVersion: "1.0.0"` and asserts byte-identical output — the
 * proof that engagements stamped before Q2 re-resolve exactly as they did.
 *
 * NEVER edit the cases or the JSON to make a test pass. A change here is a
 * change to what pre-Q2 customers were told.
 */
import type { InherentRiskInput } from "../../lib/vendorRisk/inherentRisk.js";
import type { ScopableRequirement, ScopeResolverInput } from "../../lib/vendorRisk/scopeResolver.js";

export const GOLDEN_BENIGN: InherentRiskInput = {
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

export const GOLDEN_CORPUS: ScopableRequirement[] = [
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
  req("bcp-1", ["business-continuity"]),
  req("retention-1", ["retention", "privacy"]),
  req("obscure-1", ["niche-topic"]),
];

const MANY_CORE = Array.from({ length: 40 }, (_, i) => req(`core-${i}`, ["core"]));

const c = (name: string, over: Partial<ScopeResolverInput>): { name: string; input: ScopeResolverInput } => ({
  name,
  input: {
    tier: "tier_3_moderate",
    inherent: GOLDEN_BENIGN,
    requirements: GOLDEN_CORPUS,
    obligationEdges: [],
    ...over,
  },
});

/** Named, ordered cases. Names are the keys of the golden JSON. */
export const GOLDEN_CASES = [
  c("t4-benign", { tier: "tier_4_low" }),
  c("t3-benign", {}),
  c("t2-benign", { tier: "tier_2_high" }),
  c("t1-benign", { tier: "tier_1_critical" }),
  c("t4-read-write", { tier: "tier_4_low", inherent: { ...GOLDEN_BENIGN, access_level: "read_write" } }),
  c("t4-admin", { tier: "tier_4_low", inherent: { ...GOLDEN_BENIGN, access_level: "admin" } }),
  c("t4-confidential", { tier: "tier_4_low", inherent: { ...GOLDEN_BENIGN, data_sensitivity: "confidential" } }),
  c("t4-multi-tenant", { tier: "tier_4_low", inherent: { ...GOLDEN_BENIGN, hosting_model: "multi_tenant_saas" } }),
  c("t4-ai-embedded", { tier: "tier_4_low", inherent: { ...GOLDEN_BENIGN, ai_involvement: "embedded" } }),
  c("t4-ai-autonomous", {
    tier: "tier_4_low",
    inherent: { ...GOLDEN_BENIGN, ai_involvement: "core", ai_autonomy: "autonomous_consequential" },
  }),
  c("t4-fourth-party-high", { tier: "tier_4_low", inherent: { ...GOLDEN_BENIGN, fourth_party_exposure: "high" } }),
  c("t4-critical-dependency", { tier: "tier_4_low", inherent: { ...GOLDEN_BENIGN, operational_dependency: "critical" } }),
  // Cases S5 (1.1.0) WOULD widen — the golden proves 1.0.0 does not.
  c("t4-high-dependency", { tier: "tier_4_low", inherent: { ...GOLDEN_BENIGN, operational_dependency: "high" } }),
  c("t4-recoverability-weeks", { tier: "tier_4_low", inherent: { ...GOLDEN_BENIGN, recoverability: "weeks" } }),
  c("t4-business-critical", { tier: "tier_4_low", inherent: { ...GOLDEN_BENIGN, business_criticality: "critical" } }),
  c("t3-hipaa-obligation", {
    obligationEdges: [{ obligation_id: "ob-1", obligation_title: "HIPAA Security Rule §164.308", requirement_id: "obscure-1" }],
  }),
  c("t2-admin-dora", {
    tier: "tier_2_high",
    inherent: { ...GOLDEN_BENIGN, access_level: "admin" },
    obligationEdges: [{ obligation_id: "ob-1", obligation_title: "DORA", requirement_id: "acl-1" }],
  }),
  c("t4-assurance-core-1", { tier: "tier_4_low", assuranceCoveredRequirementIds: ["core-1"] }),
  c("t4-over-cap", { tier: "tier_4_low", requirements: MANY_CORE }),
  c("t4-over-cap-reversed", { tier: "tier_4_low", requirements: [...MANY_CORE].reverse() }),
  c("t1-everything", {
    tier: "tier_1_critical",
    inherent: {
      data_sensitivity: "restricted",
      data_volume: "mass",
      access_level: "network_access",
      operational_dependency: "critical",
      recoverability: "none",
      business_criticality: "critical",
      regulatory_exposure: "high",
      regulatory_breach_notification: true,
      ai_involvement: "core",
      ai_autonomy: "autonomous_consequential",
      hosting_model: "multi_tenant_saas",
      fourth_party_exposure: "high",
      concentration: "single_point_of_failure",
    },
    obligationEdges: [{ obligation_id: "ob-2", obligation_title: "GDPR Art. 28", requirement_id: "privacy-1" }],
    assuranceCoveredRequirementIds: ["acl-1", "tenancy-1"],
  }),
] as const;
