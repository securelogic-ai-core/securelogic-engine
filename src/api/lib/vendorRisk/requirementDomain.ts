/**
 * requirementDomain.ts — the closed assessment-domain taxonomy and the
 * requirement→domain rule (VA-Q2 P1; VA-Q0 §5, §6.3; ADR-0013 R1).
 *
 * PURE. Six domains, one vocabulary, shared verbatim by:
 *   - `questions.domain` (migration 20261059 CHECK),
 *   - the S5 domain-activation rules in `scopeResolver.ts`,
 *   - the fact registry (`factRegistry.ts`, each fact names the domains it
 *     can activate),
 *   - `vendor_engagement_scope_items.domain` (P2, slot 20261062).
 *
 * `domainForScopeTags` was born in `questionnaire/questionContent.ts` as the
 * bridge questions' honest-domain rule; Q2 promotes it here as a versioned
 * rule (it is part of the SCOPE_RULE_VERSION 1.1.0 corpus). questionContent
 * re-exports it, so nothing that imported it changes behaviour.
 *
 * Precedence when a requirement carries tags from several domains: the most
 * specific non-security domain wins (a "privacy + access-control" requirement
 * is a privacy question) and `security` is the floor — an untagged or
 * core-only requirement is a security question. `compliance` is never derived
 * from a tag: it is the domain of a requirement REACHED THROUGH an obligation
 * edge (S3), regardless of tag (VA-Q0 §5).
 */

/** The ONE domain vocabulary. Closed; mirrors the 20261059 CHECK exactly. */
export const ASSESSMENT_DOMAINS = [
  "security",
  "privacy",
  "ai",
  "resilience",
  "nth_party",
  "compliance",
] as const;
export type AssessmentDomain = (typeof ASSESSMENT_DOMAINS)[number];

export function isAssessmentDomain(value: unknown): value is AssessmentDomain {
  return typeof value === "string" && (ASSESSMENT_DOMAINS as readonly string[]).includes(value);
}

/**
 * Tag → domain. Every key is a member of `SCOPE_TAG_VOCABULARY`
 * (`requirementScopeTags.ts`); a tag absent here is a security tag by the
 * floor rule. The nine starred VA-Q0 §5 tags join in P2 together with the
 * vocabulary — this table and the vocabulary must move together (tested).
 */
export const TAG_DOMAIN: Readonly<Record<string, Exclude<AssessmentDomain, "security" | "compliance">>> = {
  privacy: "privacy",
  "data-protection": "privacy",
  retention: "privacy",
  "ai-governance": "ai",
  "model-risk": "ai",
  explainability: "ai",
  "human-oversight": "ai",
  resilience: "resilience",
  "business-continuity": "resilience",
  "supply-chain": "nth_party",
  subprocessor: "nth_party",
};

/** Most specific first. `security` is the floor; `compliance` is S3-only. */
export const DOMAIN_PRECEDENCE: readonly AssessmentDomain[] = ["ai", "privacy", "nth_party", "resilience"];

/**
 * The tags that make up a domain's requirement set — the inverse of
 * `TAG_DOMAIN`, plus the security floor tags. S5 activates a domain by
 * including every requirement carrying one of its tags.
 */
export const DOMAIN_TAGS: Readonly<Record<Exclude<AssessmentDomain, "compliance">, readonly string[]>> = {
  security: [
    "core",
    "access-control",
    "iam",
    "privileged-access",
    "segregation-of-duties",
    "encryption",
    "tenancy-isolation",
    "logging",
    "incident-response",
  ],
  privacy: ["privacy", "data-protection", "retention"],
  ai: ["ai-governance", "model-risk", "explainability", "human-oversight"],
  resilience: ["resilience", "business-continuity"],
  nth_party: ["supply-chain", "subprocessor"],
};

export function domainForScopeTags(tags: readonly string[]): AssessmentDomain {
  const found = new Set<AssessmentDomain>();
  for (const t of tags) {
    const d = TAG_DOMAIN[t];
    if (d) found.add(d);
  }
  for (const d of DOMAIN_PRECEDENCE) if (found.has(d)) return d;
  return "security";
}

/**
 * The domain a requirement is asked under. A requirement reached through an
 * active obligation (S3) is a compliance question whatever its tags say —
 * that is the only way `compliance` is ever assigned.
 */
export function domainForRequirement(
  req: { scope_tags: readonly string[] },
  reachedViaObligation: boolean
): AssessmentDomain {
  if (reachedViaObligation) return "compliance";
  return domainForScopeTags(req.scope_tags);
}
