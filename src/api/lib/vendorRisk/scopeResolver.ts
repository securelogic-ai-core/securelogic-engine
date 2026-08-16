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
 * ── Four rule families ──────────────────────────────────────────────────────
 *
 *   S1 tier baseline       the assessment tier selects a baseline set by tag
 *   S2 context triggers    a dimension at/above a threshold pulls in a tag group
 *   S3 regulatory          the org's ACTIVE obligations map to requirements
 *                          through the shipped obligation_mappings table — zero
 *                          new reference data for the regulatory dimension
 *   S4 assurance offset    requirements already covered by an in-validity,
 *                          unqualified independent report drop to `confirm`
 *                          depth — NEVER removed
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

import { SCOPE_RULE_VERSION } from "./methodologyVersion.js";
import type { AssessmentTier } from "./riskBands.js";
import type {
  AccessLevel,
  AiInvolvement,
  DataSensitivity,
  HostingModel,
  InherentRiskInput,
} from "./inherentRisk.js";

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
};

export type ScopeInclusionReason = {
  rule_id: string;
  rule_family: "S1" | "S2" | "S3" | "S4";
  rationale: string;
};

export type ScopeItem = {
  requirement_id: string;
  depth: ScopeDepth;
  mandatory: boolean;
  source: ScopeSource;
  /** EVERY rule that included this requirement, not just the first. */
  reasons: ScopeInclusionReason[];
};

export type ScopeResolution = {
  scope_rule_version: string;
  tier: AssessmentTier;
  items: ScopeItem[];
  /** Requirements considered and deliberately excluded, with the reason. */
  excluded: Array<{ requirement_id: string; rationale: string }>;
  /** Non-empty when the tier cap bound. Never silent. */
  truncated: { cap: number; dropped_requirement_ids: string[] } | null;
};

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

// ── The resolver ────────────────────────────────────────────────────────────

function matchesTags(req: ScopableRequirement, tags: string[]): boolean {
  if (tags.includes("*")) return true;
  return req.scope_tags.some((t) => tags.includes(t));
}

export function resolveEngagementScope(input: ScopeResolverInput): ScopeResolution {
  const { tier, inherent, requirements, obligationEdges } = input;
  const covered = new Set(input.assuranceCoveredRequirementIds ?? []);

  /** requirement_id -> accumulating item */
  const chosen = new Map<string, ScopeItem>();

  const include = (
    req: ScopableRequirement,
    reason: ScopeInclusionReason,
    depth: ScopeDepth,
    mandatory: boolean
  ): void => {
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
      true
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
        true
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
      true
    );
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

  if (items.length > cap) {
    // Deterministic ordering: mandatory first, then deepest ask, then id — so
    // the same inputs always drop the same requirements.
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
        : `No rule in scope-rule-set ${SCOPE_RULE_VERSION} includes this requirement for a ${tier.replace(/_/g, " ")} vendor.`,
    }));

  return {
    scope_rule_version: SCOPE_RULE_VERSION,
    tier,
    items,
    excluded,
    truncated,
  };
}
