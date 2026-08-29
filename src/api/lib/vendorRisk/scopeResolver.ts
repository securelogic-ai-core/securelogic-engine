/**
 * scopeResolver.ts — deterministic questionnaire scoping.
 *
 * PURE. No I/O, no DB, no LLM. Given the vendor's inherent risk, the engagement
 * context, and the org's activated requirements, it returns the exact set of
 * requirements to ask about — and, for every one of them, WHY.
 *
 * ── The ratified principle ──────────────────────────────────────────────────
 *
 *   "Questionnaire scope must be deterministic first, AI-assisted second. AI must
 *    not be the opaque authority deciding which controls apply."
 *
 * So inclusion is decided here, by named rules over structured inputs, and never
 * by a model. AI may PROPOSE additional items, but those arrive as scope items
 * with `source: 'ai_suggested'` and are invisible to the vendor until a human
 * accepts them — which is why `source` is on the output type rather than being
 * inferred later.
 *
 * ── Five rule families ──────────────────────────────────────────────────────
 *
 *   S1 tier baseline       the assessment tier selects a baseline set by tag
 *   S2 context triggers    a dimension at/above a threshold pulls in a tag group
 *   S3 regulatory          the org's ACTIVE obligations map to requirements
 *                          through the shipped obligation_mappings table — zero
 *                          new reference data for the regulatory dimension
 *   S4 assurance offset    requirements already covered by an in-validity,
 *                          unqualified independent report drop to `confirm`
 *                          depth — NEVER removed
 *   S5 domain activation   (1.1.0, VA-Q2) a DOMAIN — Security, Privacy, AI,
 *                          Resilience, Nth party — activates from declared
 *                          FACTS (`factRegistry.ts`), pulling in every
 *                          requirement of that domain. One `rule_id` per
 *                          activation clause. S5 ONLY ADDS (ADR-0013 R4): it
 *                          has no `exclude` effect, by type. Compliance is
 *                          never an S5 activation — it is the domain of what
 *                          S3 reaches.
 *
 * ── Version gate ────────────────────────────────────────────────────────────
 *
 * The engagement's STAMPED `scope_rule_version` selects the corpus. S5 runs
 * only for engagements stamped >= 1.1.0; under 1.0.0 the output is
 * byte-identical to VA-6's resolver (golden-tested). That is what makes a
 * corpus upgrade safe: it applies to engagements created after it, never to
 * a questionnaire a customer already scoped.
 *
 * A requirement may be included by SEVERAL rules. All of them are recorded:
 * "why is this here" often has more than one true answer, and keeping only the
 * first is a lie the customer can catch.
 *
 * ── Anti-bloat, without silent truncation ───────────────────────────────────
 *
 * Each tier carries a question cap. If the rules would exceed it, the overflow
 * is RECORDED (`truncated`, with the dropped ids) rather than quietly dropped —
 * the repo's standing no-silent-caps principle. A scope that silently shrank
 * would read as "we asked everything that applies" when it did not.
 */

import { SCOPE_RULE_VERSION, SCOPE_RULE_VERSION_S5 } from "./methodologyVersion.js";
import type { AssessmentTier } from "./riskBands.js";
import type {
  AccessLevel,
  AiInvolvement,
  DataSensitivity,
  HostingModel,
  InherentRiskInput,
} from "./inherentRisk.js";
import {
  factAssertedBy,
  factAtLeast,
  factBool,
  factList,
  factsFromInherent,
  inherentFromFacts,
  resolveFacts,
  type FactSet,
} from "./factResolver.js";
import type { FactKey } from "./factRegistry.js";
import {
  DOMAIN_TAGS,
  domainForRequirement,
  type AssessmentDomain,
} from "./requirementDomain.js";

/** How deeply a requirement is asked. */
export const SCOPE_DEPTHS = ["full", "confirm", "attest"] as const;
export type ScopeDepth = (typeof SCOPE_DEPTHS)[number];

/** Where a scope item came from. AI-suggested items require human acceptance. */
export const SCOPE_SOURCES = ["deterministic", "ai_suggested"] as const;
export type ScopeSource = (typeof SCOPE_SOURCES)[number];

/**
 * A requirement as the resolver sees it. `scope_tags` is the one new piece of
 * reference data the whole model needs; everything else already ships.
 */
export type ScopableRequirement = {
  requirement_id: string;
  framework_id: string;
  reference_id: string;
  title: string;
  scope_tags: string[];
};

/** An obligation→requirement edge, read from the shipped obligation_mappings table. */
export type ObligationEdge = {
  obligation_id: string;
  obligation_title: string;
  requirement_id: string;
};

export type ScopeResolverInput = {
  tier: AssessmentTier;
  inherent: InherentRiskInput;
  /** Requirements of every framework the org has activated. */
  requirements: ScopableRequirement[];
  /** Edges from the org's ACTIVE obligations only — filtering is the caller's job. */
  obligationEdges: ObligationEdge[];
  /**
   * Requirement ids already covered by an APPROVED, in-validity, unqualified
   * assurance report. Approved — not raw extraction output: an LLM-derived fact
   * must not silently reduce questionnaire depth (see S4).
   */
  assuranceCoveredRequirementIds?: string[];
  /**
   * The ONE fact surface (VA-Q2). Defaults to the 13 inherent inputs mirrored
   * as `core.*` intake facts. S2 reads its `core.*` view; S5 reads all of it.
   */
  facts?: FactSet;
  /**
   * The engagement's STAMPED `scope_rule_version`. Selects the rule corpus:
   * S5 runs only at >= 1.1.0. Defaults to the current constant — a caller
   * composing a NEW engagement gets the current corpus.
   */
  scopeRuleVersion?: string;
};

export type ScopeRuleFamily = "S1" | "S2" | "S3" | "S4" | "S5";

export type ScopeInclusionReason = {
  rule_id: string;
  rule_family: ScopeRuleFamily;
  rationale: string;
};

export type ScopeItem = {
  requirement_id: string;
  depth: ScopeDepth;
  mandatory: boolean;
  source: ScopeSource;
  /** EVERY rule that included this requirement, not just the first. */
  reasons: ScopeInclusionReason[];
  /**
   * The domain this requirement is asked under (>= 1.1.0 only; absent under
   * 1.0.0 so pre-Q2 output is byte-identical). `compliance` iff reached via S3.
   */
  domain?: AssessmentDomain;
};

/**
 * One applicability determination: a rule fired, and it matched a requirement.
 *
 * Recorded at the moment of inclusion — BEFORE composition truncates anything —
 * which is the whole point: today a rule whose every item is dropped leaves no
 * trace at all (#926).
 *
 * Deliberately NOT part of `ScopeResolution`. The 1.0.0 golden test compares
 * `JSON.stringify` of the whole resolution object against 21 frozen fixtures,
 * so adding a field there would rewrite a frozen equivalence proof. Callers that
 * want applicability use `resolveEngagementScopeWithApplicability`.
 */
export type ApplicabilityRecord = {
  rule_id: string;
  rule_family: ScopeInclusionReason["rule_family"];
  /** Absent under 1.0.0, which has no domain rule. */
  domain: AssessmentDomain | null;
  requirement_id: string;
  /** The requirement's reference AS IT WAS — reference data is mutable. */
  requirement_reference_id: string;
  /**
   * Why it applied, captured as VALUES rather than pointers. Facts supersede
   * and obligations deactivate; a row id would dangle, and re-deriving from
   * today's state answers a different question.
   */
  basis: Record<string, unknown>;
};

export type ScopeResolution = {
  scope_rule_version: string;
  tier: AssessmentTier;
  items: ScopeItem[];
  /** Requirements considered and deliberately excluded, with the reason. */
  excluded: Array<{ requirement_id: string; rationale: string }>;
  /** Non-empty when the tier cap bound. Never silent. */
  truncated: { cap: number; dropped_requirement_ids: string[] } | null;
  /**
   * How the questionnaire was composed against the tier's nominal target
   * (>= 1.1.0 only; absent under 1.0.0 so pre-Q2 output stays byte-identical).
   *
   * `nominal_target` is a TARGET, not a ceiling: `total` exceeds it whenever the
   * mandatory floor alone does, and `mandatory_overage` says by how much.
   */
  composition?: {
    /** The tier's nominal question target (`TIER_QUESTION_CAP`). */
    nominal_target: number;
    /** Items on the SecureLogic assessment floor. Never truncated. */
    mandatory: number;
    /** Risk-triggered items kept after the floor took its room. */
    discretionary: number;
    /** `mandatory + discretionary` — what the vendor is actually asked. */
    total: number;
    /** How far the floor alone exceeds the nominal target. 0 when it fits. */
    mandatory_overage: number;
  };
};

/**
 * The SecureLogic assessment floor: rules whose items MUST survive
 * truncation.
 *
 * Owner ruling 2026-08-29 (issue #922). Before it, every item was
 * `mandatory: true` — all four rule families pass `true` — which made that flag
 * inert as a sort key and left DEPTH as the effective tiebreak. Since
 * `S5.security.baseline` asks at `attest` depth and the domain rules ask at
 * `full`, a curated multi-domain corpus displaced every security item at
 * tier 4: a low-risk vendor handling personal data and AI received a
 * questionnaire with NO security questions in it.
 *
 * These two rules are what SecureLogic asks of a vendor *because of the tier
 * itself*, not because a risk fact triggered them:
 *   - `S1.baseline`          — the tier's own baseline set;
 *   - `S5.security.baseline` — `applies: () => true`, i.e. security is assessed
 *                              for every vendor. That promise has to be kept
 *                              when the corpus is crowded, or it is not a
 *                              promise.
 *
 * S2 (fact triggers), S3 (obligations) and the non-security S5 domain rules are
 * risk-triggered and remain discretionary: they compete for the room the floor
 * leaves. That is a deliberate line — a regulatory obligation is important, but
 * it is not a SecureLogic minimum.
 */
const FLOOR_RULE_IDS: ReadonlySet<string> = new Set(["S1.baseline", "S5.security.baseline"]);

/**
 * The fact VALUES a rule read, for the applicability basis (#926).
 *
 * Deliberately narrow: only the keys the named rule actually consults, so the
 * record says why THIS rule fired rather than dumping the whole fact surface
 * into every row. Values, never row ids — facts supersede.
 */
const RULE_FACT_KEYS: Readonly<Record<string, readonly FactKey[]>> = {
  "S2.ai_prompts": ["ai.customer_data_in_prompts"],
  "S2.cross_border": ["data.cross_border"],
  "S2.subprocessors": ["nth.subprocessors_declared"],
  "S5.privacy.personal_data": ["data.personal_data"],
  "S5.privacy.sensitivity": ["core.data_sensitivity"],
  "S5.privacy.obligation": ["policy.privacy_obligations_active"],
  "S5.privacy.ai_prompts": ["ai.customer_data_in_prompts"],
  "S5.ai.involvement": ["core.ai_involvement"],
  "S5.ai.declared": ["ai.uses_ai"],
  "S5.ai.dependency": ["ai.uses_ai"],
  "S5.resilience.dependency": ["core.operational_dependency"],
  "S5.resilience.recoverability": ["core.recoverability"],
  "S5.resilience.criticality": ["core.business_criticality"],
  "S5.nth.fourth_party": ["core.fourth_party_exposure"],
  "S5.nth.subprocessors": ["nth.subprocessors_declared"],
  "S5.nth.third_party_models": ["ai.third_party_models"],
};

function triggerFactBasis(facts: FactSet, ruleId: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of RULE_FACT_KEYS[ruleId] ?? []) {
    const f = facts[key as keyof FactSet];
    if (f !== undefined) out[key] = f.value;
  }
  return out;
}

/** Is this item on the assessment floor? */
function isFloorItem(item: ScopeItem): boolean {
  return item.reasons.some((r) => FLOOR_RULE_IDS.has(r.rule_id));
}

/**
 * Deterministic drop order for DISCRETIONARY items: deepest ask first (a `full`
 * question is worth more than an `attest` one), then id, so the same inputs
 * always drop the same requirements.
 */
function discretionaryOrder(a: ScopeItem, b: ScopeItem): number {
  const depthRank = (d: ScopeDepth) => (d === "full" ? 0 : d === "confirm" ? 1 : 2);
  const dr = depthRank(a.depth) - depthRank(b.depth);
  if (dr !== 0) return dr;
  return a.requirement_id.localeCompare(b.requirement_id);
}

// ── S1: tier baselines ──────────────────────────────────────────────────────

/**
 * Tags a tier takes as its baseline. `*` means every requirement of every
 * activated framework.
 */
const TIER_BASELINE_TAGS: Record<AssessmentTier, string[]> = {
  tier_1_critical: ["*"],
  tier_2_high: ["core", "access-control", "data-protection", "incident-response", "resilience"],
  tier_3_moderate: ["core", "access-control", "data-protection"],
  tier_4_low: ["core"],
};

/** Deterministic question cap per tier. Exceeding it records the overflow. */
const TIER_QUESTION_CAP: Record<AssessmentTier, number> = {
  tier_1_critical: 250,
  tier_2_high: 120,
  tier_3_moderate: 60,
  tier_4_low: 15,
};

/** Depth the tier asks its baseline at. */
const TIER_BASELINE_DEPTH: Record<AssessmentTier, ScopeDepth> = {
  tier_1_critical: "full",
  tier_2_high: "full",
  tier_3_moderate: "full",
  tier_4_low: "attest",
};

// ── S2: context triggers ────────────────────────────────────────────────────

type ContextTrigger = {
  rule_id: string;
  tags: string[];
  applies: (i: InherentRiskInput) => boolean;
  rationale: string;
};

const ACCESS_RANK: Record<AccessLevel, number> = {
  none: 0,
  read_only: 1,
  read_write: 2,
  admin: 3,
  network_access: 4,
};
const SENSITIVITY_RANK: Record<DataSensitivity, number> = {
  none: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

export const CONTEXT_TRIGGERS: ContextTrigger[] = [
  {
    rule_id: "S2.access",
    tags: ["access-control", "iam"],
    applies: (i) => ACCESS_RANK[i.access_level] >= ACCESS_RANK.read_write,
    rationale: "The vendor can change data in your systems, so access control is in scope.",
  },
  {
    rule_id: "S2.privileged",
    tags: ["privileged-access", "logging", "segregation-of-duties"],
    applies: (i) => ACCESS_RANK[i.access_level] >= ACCESS_RANK.admin,
    rationale: "The vendor holds privileged or network-level access to your environment.",
  },
  {
    rule_id: "S2.pii",
    tags: ["privacy", "data-protection", "retention"],
    applies: (i) => SENSITIVITY_RANK[i.data_sensitivity] >= SENSITIVITY_RANK.confidential,
    rationale: "The vendor handles confidential or restricted data.",
  },
  {
    rule_id: "S2.tenancy",
    tags: ["tenancy-isolation", "encryption"],
    applies: (i: { hosting_model: HostingModel }) => i.hosting_model === "multi_tenant_saas",
    rationale: "The service is multi-tenant, so logical isolation between customers is in scope.",
  },
  {
    rule_id: "S2.ai",
    tags: ["ai-governance", "model-risk", "explainability"],
    applies: (i: { ai_involvement: AiInvolvement }) => i.ai_involvement !== "none",
    rationale: "The service involves AI, so AI-governance requirements apply (NIST AI RMF).",
  },
  {
    rule_id: "S2.ai_autonomy",
    tags: ["human-oversight", "model-risk"],
    applies: (i) =>
      i.ai_involvement !== "none" && i.ai_autonomy === "autonomous_consequential",
    rationale:
      "The vendor's AI makes consequential decisions without human review, so oversight controls apply.",
  },
  {
    rule_id: "S2.fourth_party",
    tags: ["supply-chain", "subprocessor"],
    applies: (i) => i.fourth_party_exposure === "moderate" || i.fourth_party_exposure === "high",
    rationale: "The vendor relies materially on its own sub-processors.",
  },
  {
    rule_id: "S2.resilience",
    tags: ["resilience", "business-continuity"],
    applies: (i) =>
      i.operational_dependency === "critical" || i.recoverability === "none",
    rationale: "You cannot readily operate without this vendor, so continuity controls apply.",
  },
];

/**
 * S2 triggers that read NON-CORE facts (VA-Q2 P4; VA-Q0 §6.2 "S2 reads facts").
 *
 * Kept as a SEPARATE table from `CONTEXT_TRIGGERS` on purpose, for two reasons
 * that are both about not breaking things:
 *
 *  1. **Version gate.** These run only under the >= 1.1.0 corpus, alongside S5.
 *     The route passes declared facts to every resolve regardless of the stamped
 *     version, so a fact-reading trigger in the shared table would fire for a
 *     1.0.0 engagement and change a questionnaire that is frozen by 21 golden
 *     cases. Pre-Q2 engagements must not move.
 *  2. **Signature.** `CONTEXT_TRIGGERS` read the 13 inherent inputs and nothing
 *     else. Widening that signature to carry a `FactSet` would touch eight rules
 *     that have no use for it.
 *
 * `accepted`-only is inherited, not re-implemented: `resolveFacts` already drops
 * any row whose status is not `accepted`, and refuses an `ai_extraction` row
 * that was never accepted. A test asserts that rather than trusting the comment.
 */
type FactContextTrigger = {
  rule_id: string;
  tags: string[];
  applies: (facts: FactSet) => boolean;
  rationale: string;
};

export const FACT_CONTEXT_TRIGGERS: FactContextTrigger[] = [
  {
    rule_id: "S2.ai_prompts",
    tags: ["privacy", "data-protection", "ai-governance", "model-provider"],
    applies: (facts) => factBool(facts, "ai.customer_data_in_prompts") === true,
    rationale:
      "Customer data is passed to AI models, so how that data is handled is both a privacy and an AI-governance question.",
  },
  {
    rule_id: "S2.cross_border",
    tags: ["cross-border", "data-protection"],
    applies: (facts) => factBool(facts, "data.cross_border") === true,
    rationale:
      "Personal data crosses a border, so transfer safeguards and data-protection controls apply.",
  },
  {
    rule_id: "S2.subprocessors",
    tags: ["supply-chain", "subprocessor"],
    applies: (facts) => factBool(facts, "nth.subprocessors_declared") === true,
    rationale:
      "The vendor has declared sub-processors, so supply-chain and sub-processor controls apply.",
  },
];

// ── S5: domain activation (VA-Q0 §6.3, the authoritative table) ─────────────

/**
 * An activation clause. `rationale` is a STATIC string — it is rendered to the
 * vendor, so it must never interpolate a fact value (T-13; tested). The
 * effect is always "include this domain's requirements at `depth`,
 * mandatory": there is no `exclude` field on this type, which is how
 * ADR-0013 R4 ("S5 only ever adds") is held at the type level.
 */
export type DomainActivationRule = {
  rule_id: string;
  domain: Exclude<AssessmentDomain, "compliance">;
  depth: ScopeDepth;
  applies: (ctx: { facts: FactSet; tier: AssessmentTier }) => boolean;
  rationale: string;
};

const TIER_RANK: Record<AssessmentTier, number> = {
  tier_1_critical: 1,
  tier_2_high: 2,
  tier_3_moderate: 3,
  tier_4_low: 4,
};

export const DOMAIN_ACTIVATION: readonly DomainActivationRule[] = [
  // Security — always. Its baseline is what S1 already asks (the `core` set at
  // the tier's depth); S5 records the activation as a reason and never widens
  // beyond it, so a no-access / no-data / no-AI vendor stays at Security attest.
  {
    rule_id: "S5.security.baseline",
    domain: "security",
    depth: "attest",
    applies: () => true,
    rationale: "Security is assessed for every vendor; this is the baseline security question set.",
  },

  // Privacy
  {
    rule_id: "S5.privacy.personal_data",
    domain: "privacy",
    depth: "full",
    applies: ({ facts }) => factBool(facts, "data.personal_data") === true,
    rationale: "Personal data is declared in scope, so the privacy question set applies.",
  },
  {
    rule_id: "S5.privacy.sensitivity",
    domain: "privacy",
    depth: "full",
    applies: ({ facts }) => factAtLeast(facts, "core.data_sensitivity", "confidential"),
    rationale: "The vendor handles confidential or restricted data, so the privacy question set applies.",
  },
  {
    rule_id: "S5.privacy.obligation",
    domain: "privacy",
    depth: "full",
    applies: ({ facts }) => factList(facts, "policy.privacy_obligations_active").length > 0,
    rationale: "A privacy obligation (such as GDPR, CCPA or HIPAA) is active for your organisation.",
  },
  {
    rule_id: "S5.privacy.ai_prompts",
    domain: "privacy",
    depth: "full",
    applies: ({ facts }) => factBool(facts, "ai.customer_data_in_prompts") === true,
    rationale: "Customer data is passed to AI models, so how that data is handled is a privacy question.",
  },

  // AI
  {
    rule_id: "S5.ai.involvement",
    domain: "ai",
    depth: "full",
    applies: ({ facts }) => factAtLeast(facts, "core.ai_involvement", "embedded"),
    rationale: "The service involves AI, so the AI-governance question set applies (NIST AI RMF).",
  },
  {
    rule_id: "S5.ai.declared",
    domain: "ai",
    depth: "full",
    applies: ({ facts }) => factBool(facts, "ai.uses_ai") === true,
    rationale: "The vendor uses AI or machine learning in the service, so the AI-governance question set applies.",
  },
  {
    rule_id: "S5.ai.dependency",
    domain: "ai",
    depth: "full",
    applies: ({ facts }) =>
      factBool(facts, "ai.uses_ai") === true && factAssertedBy(facts, "ai.uses_ai", "ai_system_dependency"),
    rationale: "One of your inventoried AI systems depends on this vendor, so the AI-governance question set applies.",
  },

  // Resilience
  {
    rule_id: "S5.resilience.dependency",
    domain: "resilience",
    depth: "full",
    applies: ({ facts }) => factAtLeast(facts, "core.operational_dependency", "high"),
    rationale: "Your operations depend heavily on this vendor, so continuity and resilience controls apply.",
  },
  {
    rule_id: "S5.resilience.recoverability",
    domain: "resilience",
    depth: "full",
    applies: ({ facts }) => factAtLeast(facts, "core.recoverability", "weeks"),
    rationale: "Recovering from an outage of this vendor would take weeks or has no workaround, so resilience controls apply.",
  },
  {
    rule_id: "S5.resilience.criticality",
    domain: "resilience",
    depth: "full",
    applies: ({ facts }) => factAtLeast(facts, "core.business_criticality", "high"),
    rationale: "This vendor is business-critical, so continuity and resilience controls apply.",
  },
  {
    rule_id: "S5.resilience.tier",
    domain: "resilience",
    depth: "full",
    applies: ({ tier }) => TIER_RANK[tier] <= 2,
    rationale: "High and critical tier vendors are always assessed for resilience.",
  },

  // Fourth / Nth party
  {
    rule_id: "S5.nth.fourth_party",
    domain: "nth_party",
    depth: "full",
    applies: ({ facts }) => factAtLeast(facts, "core.fourth_party_exposure", "moderate"),
    rationale: "The vendor relies materially on its own sub-processors, so supply-chain controls apply.",
  },
  {
    rule_id: "S5.nth.subprocessors",
    domain: "nth_party",
    depth: "full",
    applies: ({ facts }) => factBool(facts, "nth.subprocessors_declared") === true,
    rationale: "Sub-processors are declared, so supply-chain and sub-processor controls apply.",
  },
  {
    rule_id: "S5.nth.third_party_models",
    domain: "nth_party",
    depth: "full",
    applies: ({ facts }) => factBool(facts, "ai.third_party_models") === true,
    rationale: "The service relies on third-party AI models, so the model provider is a sub-processor in scope.",
  },
];

/** Minimal semver compare over MAJOR.MINOR.PATCH. Malformed → treated as 0.0.0 (never S5). */
function versionAtLeast(version: string, floor: string): boolean {
  const parse = (v: string): number[] => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  };
  const a = parse(version);
  const b = parse(floor);
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return true;
}

/** Whether the S5 corpus applies for a stamped version. Exported for the route and tests. */
export function scopeVersionRunsS5(scopeRuleVersion: string): boolean {
  return versionAtLeast(scopeRuleVersion, SCOPE_RULE_VERSION_S5);
}

// ── The resolver ────────────────────────────────────────────────────────────

function matchesTags(req: ScopableRequirement, tags: readonly string[]): boolean {
  if (tags.includes("*")) return true;
  return req.scope_tags.some((t) => tags.includes(t));
}

/**
 * The resolution PLUS what applied, for callers that must persist applicability
 * independently of composition (#926).
 *
 * `resolveEngagementScope` delegates here and returns only `.resolution`, so the
 * frozen 1.0.0 goldens keep comparing exactly the object they always did.
 */
export function resolveEngagementScopeWithApplicability(
  input: ScopeResolverInput
): { resolution: ScopeResolution; applicability: ApplicabilityRecord[] } {
  const applicability: ApplicabilityRecord[] = [];
  const resolution = resolveInternal(input, applicability);
  return { resolution, applicability };
}

export function resolveEngagementScope(input: ScopeResolverInput): ScopeResolution {
  return resolveInternal(input, []);
}

function resolveInternal(
  input: ScopeResolverInput,
  applicability: ApplicabilityRecord[]
): ScopeResolution {
  const { tier, requirements, obligationEdges } = input;
  const covered = new Set(input.assuranceCoveredRequirementIds ?? []);

  // The version the STAMP selects, echoed back on the resolution so the audit
  // record and the response say which corpus actually ran.
  const scopeRuleVersion = input.scopeRuleVersion ?? SCOPE_RULE_VERSION;
  const runS5 = scopeVersionRunsS5(scopeRuleVersion);

  // One fact surface. S2's predicates keep their InherentRiskInput shape but
  // read it THROUGH the facts (identical predicates, VA-Q0 §6.2).
  const facts: FactSet = input.facts ?? resolveFacts(factsFromInherent(input.inherent));
  const inherent = inherentFromFacts(facts, input.inherent);

  /** requirement_id -> accumulating item */
  const chosen = new Map<string, ScopeItem>();

  const include = (
    req: ScopableRequirement,
    reason: ScopeInclusionReason,
    depth: ScopeDepth,
    mandatory: boolean,
    /**
     * Why this rule fired, as VALUES. Recorded for #926 whether or not the item
     * survives composition — a rule whose every item is later truncated must
     * still be answerable.
     */
    basis: Record<string, unknown> = {}
  ): void => {
    // Every (rule, requirement) pair is one applicability determination, even
    // when the requirement was already chosen by an earlier rule: "why is this
    // in scope" genuinely has more than one answer, and #926 needs all of them.
    applicability.push({
      rule_id: reason.rule_id,
      rule_family: reason.rule_family,
      domain: null, // stamped below, once S5 has decided
      requirement_id: req.requirement_id,
      requirement_reference_id: req.reference_id,
      basis,
    });

    const existing = chosen.get(req.requirement_id);
    if (existing) {
      // Record EVERY rule that included it. Depth escalates to the deepest ask,
      // and mandatory is sticky — a requirement pulled in by a mandatory rule
      // cannot be softened by a later optional one.
      existing.reasons.push(reason);
      if (depth === "full" || existing.depth === "attest") {
        existing.depth = depth === "full" ? "full" : existing.depth;
      }
      existing.mandatory = existing.mandatory || mandatory;
      return;
    }
    chosen.set(req.requirement_id, {
      requirement_id: req.requirement_id,
      depth,
      mandatory,
      source: "deterministic",
      reasons: [reason],
    });
  };

  // S1 — tier baseline
  const baselineTags = TIER_BASELINE_TAGS[tier];
  const baselineDepth = TIER_BASELINE_DEPTH[tier];
  for (const req of requirements) {
    if (!matchesTags(req, baselineTags)) continue;
    include(
      req,
      {
        rule_id: "S1.baseline",
        rule_family: "S1",
        rationale:
          baselineTags.includes("*")
            ? `This vendor is ${tier.replace(/_/g, " ")}, so the full requirement set applies.`
            : `Baseline for ${tier.replace(/_/g, " ")} vendors.`,
      },
      baselineDepth,
      true,
      { tier, baseline_tags: baselineTags }
    );
  }

  // S2 — context triggers
  for (const trigger of CONTEXT_TRIGGERS) {
    if (!trigger.applies(inherent)) continue;
    for (const req of requirements) {
      if (!matchesTags(req, trigger.tags)) continue;
      include(
        req,
        { rule_id: trigger.rule_id, rule_family: "S2", rationale: trigger.rationale },
        "full",
        true,
        { rule_id: trigger.rule_id, inherent_trigger: true }
      );
    }
  }

  // S3 — regulatory derivation, through the shipped obligation_mappings edges
  const byId = new Map(requirements.map((r) => [r.requirement_id, r]));
  for (const edge of obligationEdges) {
    const req = byId.get(edge.requirement_id);
    if (!req) continue;
    include(
      req,
      {
        rule_id: "S3.obligation",
        rule_family: "S3",
        rationale: `Required by your active obligation "${edge.obligation_title}".`,
      },
      "full",
      true,
      // The obligation may be deactivated later. Its TITLE is captured, not
      // only its id, so "which obligation made this apply" survives.
      { obligation_id: edge.obligation_id, obligation_title: edge.obligation_title }
    );
  }

  // S2-from-facts — the non-core fact triggers (>= 1.1.0 only, same gate as S5).
  if (runS5) {
    for (const trigger of FACT_CONTEXT_TRIGGERS) {
      if (!trigger.applies(facts)) continue;
      for (const req of requirements) {
        if (!matchesTags(req, trigger.tags)) continue;
        include(
          req,
          { rule_id: trigger.rule_id, rule_family: "S2", rationale: trigger.rationale },
          "full",
          true,
          // Facts supersede. The VALUE that fired the rule is captured, not a
          // pointer to a row that a later assertion will mark superseded.
          { facts: triggerFactBasis(facts, trigger.rule_id) }
        );
      }
    }
  }

  // S5 — domain activation (>= 1.1.0 only). ADDS, never excludes.
  if (runS5) {
    const ctx = { facts, tier };
    for (const rule of DOMAIN_ACTIVATION) {
      if (!rule.applies(ctx)) continue;
      const tags = DOMAIN_TAGS[rule.domain];
      for (const req of requirements) {
        if (!matchesTags(req, tags)) continue;
        // Security's baseline is S1's `core` set: S5.security adds no item S1
        // did not already ask, it only records the activation on those items.
        if (rule.domain === "security" && !chosen.has(req.requirement_id)) continue;
        include(
          req,
          { rule_id: rule.rule_id, rule_family: "S5", rationale: rule.rationale },
          rule.depth,
          true,
          { domain: rule.domain, facts: triggerFactBasis(facts, rule.rule_id) }
        );
      }
    }

    // Stamp the domain each item is asked under. Compliance iff reached via S3.
    // The applicability rows are stamped from the same decision below, so a
    // truncated requirement still records which domain it applied under.
    for (const item of chosen.values()) {
      const req = byId.get(item.requirement_id)!;
      item.domain = domainForRequirement(req, item.reasons.some((r) => r.rule_family === "S3"));
    }

    // Stamp the same domain onto the applicability rows. A requirement whose
    // items are truncated moments from now still records the domain it applied
    // under — which is the difference between "privacy applied and nothing was
    // asked" and silence.
    const domainByRequirement = new Map<string, AssessmentDomain>();
    for (const item of chosen.values()) {
      if (item.domain) domainByRequirement.set(item.requirement_id, item.domain);
    }
    for (const row of applicability) {
      row.domain = domainByRequirement.get(row.requirement_id) ?? null;
    }
  }

  // S4 — assurance offset. Reduces DEPTH, never removes the requirement: an
  // independent report is evidence, not a substitute for asking.
  for (const item of chosen.values()) {
    if (!covered.has(item.requirement_id)) continue;
    item.depth = "confirm";
    item.reasons.push({
      rule_id: "S4.assurance",
      rule_family: "S4",
      rationale:
        "Covered by an approved, in-validity independent assurance report — asked as a " +
        "confirmation rather than in full.",
    });
  }

  // Cap, with the overflow recorded rather than silently dropped.
  const cap = TIER_QUESTION_CAP[tier];
  let items = [...chosen.values()];
  let truncated: ScopeResolution["truncated"] = null;
  let composition: ScopeResolution["composition"] = undefined;

  if (runS5) {
    // ── >= 1.1.0: the assessment floor is satisfied FIRST ──────────────────
    //
    // The floor is never truncated, even when it alone exceeds the nominal
    // target — a size target must not silently delete a SecureLogic minimum.
    // Discretionary items then take whatever room is left, dropped in a
    // deterministic order with the overflow recorded.
    const floor = items.filter(isFloorItem);
    const discretionary = items.filter((i) => !isFloorItem(i));
    const budget = Math.max(0, cap - floor.length);

    let keptDiscretionary = discretionary;
    if (discretionary.length > budget) {
      const ordered = [...discretionary].sort(discretionaryOrder);
      keptDiscretionary = ordered.slice(0, budget);
      truncated = {
        cap,
        dropped_requirement_ids: ordered.slice(budget).map((i) => i.requirement_id),
      };
    }

    items = [...floor, ...keptDiscretionary].sort((a, b) =>
      a.requirement_id.localeCompare(b.requirement_id)
    );
    composition = {
      nominal_target: cap,
      mandatory: floor.length,
      discretionary: keptDiscretionary.length,
      total: items.length,
      mandatory_overage: Math.max(0, floor.length - cap),
    };
  } else if (items.length > cap) {
    // ── 1.0.0: frozen legacy behaviour, byte-for-byte ──────────────────────
    //
    // Deliberately NOT fixed here. 21 golden cases freeze this output and two
    // of them truncate; changing the rule would rewrite a frozen equivalence
    // proof. The defect cannot arise under 1.0.0 anyway: with no S5 there are
    // no domain rules to crowd the security baseline out.
    items.sort((a, b) => {
      if (a.mandatory !== b.mandatory) return a.mandatory ? -1 : 1;
      const depthRank = (d: ScopeDepth) => (d === "full" ? 0 : d === "confirm" ? 1 : 2);
      const dr = depthRank(a.depth) - depthRank(b.depth);
      if (dr !== 0) return dr;
      return a.requirement_id.localeCompare(b.requirement_id);
    });
    const kept = items.slice(0, cap);
    truncated = {
      cap,
      dropped_requirement_ids: items.slice(cap).map((i) => i.requirement_id),
    };
    items = kept;
  } else {
    items.sort((a, b) => a.requirement_id.localeCompare(b.requirement_id));
  }

  const includedIds = new Set(items.map((i) => i.requirement_id));
  const excluded = requirements
    .filter((r) => !includedIds.has(r.requirement_id))
    .map((r) => ({
      requirement_id: r.requirement_id,
      rationale: chosen.has(r.requirement_id)
        ? `Dropped by the ${tier.replace(/_/g, " ")} question cap of ${cap}.`
        : `No rule in scope-rule-set ${scopeRuleVersion} includes this requirement for a ${tier.replace(/_/g, " ")} vendor.`,
    }));

  return {
    scope_rule_version: scopeRuleVersion,
    tier,
    items,
    excluded,
    truncated,
    // Spread so the key is ABSENT (not `undefined`) under 1.0.0 — the golden
    // equivalence test compares JSON.stringify of the whole object.
    ...(composition === undefined ? {} : { composition }),
  };
}
