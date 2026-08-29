/**
 * requirementScopeTags.ts — the applicability vocabulary, and how a requirement
 * acquires its tags.
 *
 * `scope_tags` is the one piece of NEW reference data the deterministic scoping
 * model needs. Everything else it consumes already ships. Without tags the
 * resolver includes nothing below tier 1, so this file is the difference between
 * a working questionnaire and an empty one.
 *
 * ── The honest problem ───────────────────────────────────────────────────────
 * Tagging a corpus of requirements is a CURATION task. It wants a person who
 * knows both the framework and the assessment model, working through the corpus
 * once. That person has not done it yet.
 *
 * So this module derives a STARTING SET from the requirement's own reference and
 * title, and every derived tag is recorded with `source = 'heuristic'`. The
 * distinction is carried in the database, not just in a comment, because:
 *
 *   - a heuristic tag that is wrong must be correctable without the correction
 *     being overwritten by the next backfill;
 *   - a reviewer looking at a questionnaire deserves to know whether a control
 *     was included because someone decided it applied, or because its title
 *     contained the word "access";
 *   - and a coverage report can then answer "how much of this corpus has a human
 *     actually looked at", which is the real readiness question.
 *
 * Deriving tags from titles is a weak signal and is not pretended otherwise.
 * It is chosen over the alternatives — shipping an empty vocabulary (every
 * questionnaire below tier 1 is blank) or hand-inventing 300 mappings that
 * nobody has reviewed (confident and unverifiable) — because it is the only one
 * that is both useful and honest about what it is.
 *
 * ── Why `core` matters more than the rest ────────────────────────────────────
 * `core` is the ENTIRE tier-4 baseline. A requirement corpus with nothing tagged
 * `core` gives every low-risk vendor an empty questionnaire, which would look
 * like a working system producing a fast clean result. `coreFallback` exists for
 * exactly this: when nothing else matched, a requirement is tagged `core` rather
 * than left untagged and invisible.
 */

/**
 * The closed vocabulary. Every tag here is referenced by a rule in
 * `scopeResolver.ts`; a tag that no rule consumes would be decoration, and a
 * rule referencing a tag not in this list would silently never fire.
 */
export const SCOPE_TAG_VOCABULARY = [
  // Baseline
  "core",
  // Access
  "access-control",
  "iam",
  "privileged-access",
  "segregation-of-duties",
  // Data
  "data-protection",
  "privacy",
  "retention",
  "encryption",
  "tenancy-isolation",
  // Operations
  "logging",
  "incident-response",
  "resilience",
  "business-continuity",
  // Supply chain
  "supply-chain",
  "subprocessor",
  // AI
  "ai-governance",
  "model-risk",
  "explainability",
  "human-oversight",
  // ── VA-Q2 P2: the nine starred VA-Q0 §5 tags. CURATED-ONLY (see below). ──
  // Security
  "vulnerability-management",
  "secure-development",
  // Privacy
  "data-subject-rights",
  "cross-border",
  "lawful-basis",
  "breach-notification",
  // AI
  "training-data",
  "model-provider",
  "automated-decision",
] as const;

export type ScopeTag = (typeof SCOPE_TAG_VOCABULARY)[number];

/**
 * Tags a human must apply — `deriveScopeTags` NEVER emits them.
 *
 * Added in VA-Q2 P2 as vocabulary only: they are consumed by S5 through
 * `DOMAIN_TAGS` (requirementDomain.ts) and accepted by `areValidScopeTags`,
 * but they have no heuristic pattern. Two reasons, both deliberate:
 *   - the SQL backfill in migration 20260926 is the heuristic's mirror and is
 *     parity-tested against this module; a code-only pattern would silently
 *     desynchronise the two;
 *   - these are precisely the tags whose meaning a title cannot carry
 *     ("lawful basis", "cross-border") — a curator's judgement, not a regex.
 */
export const CURATED_ONLY_SCOPE_TAGS = [
  "vulnerability-management",
  "secure-development",
  "data-subject-rights",
  "cross-border",
  "lawful-basis",
  "breach-notification",
  "training-data",
  "model-provider",
  "automated-decision",
] as const satisfies readonly ScopeTag[];
export type CuratedOnlyScopeTag = (typeof CURATED_ONLY_SCOPE_TAGS)[number];

/**
 * How a requirement's tags were decided. Persisted in
 * `requirements.scope_tags_source` and pinned to that column's CHECK by a
 * lockstep test.
 *
 *   'curated'   — a human stood behind these tags (curated reference data in
 *                 `curatedFrameworkTags.ts`, or a PATCH through the curation
 *                 route).
 *   'heuristic' — a keyword pattern in this module matched the title.
 *   'uncurated' — NOTHING matched. The row carries `core` because the fallback
 *                 put it there, not because anyone classified it as baseline
 *                 security.
 *
 * The third value exists because the first two were not enough to tell those
 * apart: `core` is simultaneously a real classification and the fallback, so an
 * unreviewed requirement and a deliberately-security one were the same row.
 * Measured on the shipped GDPR / CCPA / NIST AI RMF templates, 11 of 24
 * requirements reached the security domain that way — including all four NIST
 * AI RMF functions, which left the AI question set empty on a framework whose
 * entire purpose is AI governance.
 */
export const SCOPE_TAG_SOURCES = ["heuristic", "curated", "uncurated"] as const;
export type ScopeTagSource = (typeof SCOPE_TAG_SOURCES)[number];

/**
 * Keyword patterns per tag, matched case-insensitively against
 * `reference_id + ' ' + title`.
 *
 * Ordered from most to least specific WITHIN each tag. Multiple tags may match
 * one requirement, which is correct — an "Encryption of personal data at rest"
 * control is genuinely both `encryption` and `privacy`.
 */
const TAG_PATTERNS: Record<Exclude<ScopeTag, "core" | CuratedOnlyScopeTag>, RegExp[]> = {
  "access-control": [/\baccess control\b/i, /\bauthoriz/i, /\bauthentication\b/i, /\bpassword\b/i, /\bmfa\b/i, /multi-?factor/i],
  iam: [/\bidentity\b/i, /\baccount (management|provisioning)\b/i, /\bjoiner\b/i, /\bleaver\b/i, /\bprovisioning\b/i],
  "privileged-access": [/\bprivileged\b/i, /\badministrat/i, /\broot access\b/i, /\bsuperuser\b/i],
  "segregation-of-duties": [/segregation of duties/i, /separation of duties/i, /\bsod\b/i],

  "data-protection": [/\bdata protection\b/i, /\bdata (handling|classification|security)\b/i, /\bconfidentialit/i],
  privacy: [/\bprivacy\b/i, /\bpersonal data\b/i, /\bpii\b/i, /\bphi\b/i, /\bgdpr\b/i, /\bdata subject\b/i, /\bconsent\b/i],
  retention: [/\bretention\b/i, /\bdisposal\b/i, /\bdeletion\b/i, /\bdestruction\b/i, /\barchiv/i],
  encryption: [/\bencrypt/i, /\bcryptograph/i, /\bkey management\b/i, /\btls\b/i, /\bat rest\b/i, /\bin transit\b/i],
  "tenancy-isolation": [/\btenan/i, /\bisolation\b/i, /\bsegregat(e|ion) of (customer|client) data\b/i, /\blogical separation\b/i],

  logging: [/\blogging\b/i, /\baudit (log|trail)\b/i, /\bmonitoring\b/i, /\bsiem\b/i, /\bevent log\b/i],
  "incident-response": [/\bincident\b/i, /\bbreach\b/i, /\bresponse plan\b/i, /\bnotification\b/i, /\bescalation\b/i],
  resilience: [/\bresilien/i, /\bavailabilit/i, /\bredundan/i, /\bfailover\b/i, /\bcapacity\b/i],
  "business-continuity": [/\bbusiness continuity\b/i, /\bbcp\b/i, /\bdisaster recovery\b/i, /\bdr\b/i, /\bbackup\b/i, /\brecovery\b/i],

  "supply-chain": [/\bsupply chain\b/i, /\bthird[- ]party\b/i, /\bvendor (management|risk)\b/i, /\bsupplier\b/i, /\boutsourc/i],
  subprocessor: [/\bsub-?processor\b/i, /\bsub-?contractor\b/i, /\bfourth[- ]party\b/i],

  "ai-governance": [/\bai governance\b/i, /\bartificial intelligence\b/i, /\bmachine learning\b/i, /\balgorithm/i, /\bautomated decision/i],
  "model-risk": [/\bmodel (risk|validation|monitoring|drift)\b/i, /\btraining data\b/i, /\bbias\b/i],
  explainability: [/\bexplainab/i, /\binterpretab/i, /\btransparen/i],
  "human-oversight": [/\bhuman (oversight|review|in the loop)\b/i, /\bmanual review\b/i],
};

/**
 * Requirements that are foundational regardless of vendor tier. These are the
 * questions worth asking a vendor who does nothing more than host a brochure
 * site, and they are what a tier-4 engagement consists of entirely.
 */
const CORE_PATTERNS: RegExp[] = [
  /\binformation security (policy|program|management)\b/i,
  /\bsecurity policy\b/i,
  /\brisk (assessment|management)\b/i,
  /\bsecurity awareness\b/i,
  /\btraining\b/i,
  /\bvulnerability (management|scanning)\b/i,
  /\bpatch(ing)?\b/i,
  /\bincident\b/i,
  /\bencrypt/i,
  /\baccess control\b/i,
  /\bbackup\b/i,
];

export type TaggedRequirement = {
  tags: ScopeTag[];
  source: ScopeTagSource;
  /** True when nothing matched and the `core` fallback supplied the tag. */
  fallback_applied: boolean;
};

/**
 * Derive tags for one requirement.
 *
 * Deterministic and pure: the same reference and title always produce the same
 * tags, which is what makes a backfill reproducible and a diff reviewable.
 */
export function deriveScopeTags(args: {
  reference_id: string;
  title: string;
  description?: string | null;
}): TaggedRequirement {
  // Description is deliberately EXCLUDED from matching. Guidance text is long
  // and mentions adjacent concepts in passing — "this control does not cover
  // encryption" would tag the requirement `encryption`. Titles are terse and
  // written to say what the control IS.
  const haystack = `${args.reference_id} ${args.title}`;

  const tags = new Set<ScopeTag>();

  for (const [tag, patterns] of Object.entries(TAG_PATTERNS)) {
    if (patterns.some((p) => p.test(haystack))) tags.add(tag as ScopeTag);
  }
  if (CORE_PATTERNS.some((p) => p.test(haystack))) tags.add("core");

  // The fallback that stops a requirement disappearing from every questionnaire.
  // An untagged requirement is not "excluded by a rule" — it is invisible, and
  // invisible is the one outcome with no reviewer-facing trace.
  const fallback = tags.size === 0;
  if (fallback) tags.add("core");

  return {
    // Sorted so a backfill diff is stable and reviewable.
    tags: [...tags].sort(),
    source: "heuristic",
    fallback_applied: fallback,
  };
}

/** Is every tag in this list part of the closed vocabulary? */
export function areValidScopeTags(tags: unknown): tags is ScopeTag[] {
  return (
    Array.isArray(tags) &&
    tags.every((t) => (SCOPE_TAG_VOCABULARY as readonly string[]).includes(t as string))
  );
}

/**
 * Coverage over a corpus — the readiness question a heuristic backfill raises.
 *
 * `curated_pct` is the number that matters before launch: it says how much of
 * the questionnaire a human has actually stood behind.
 */
export function scopeTagCoverage(
  rows: Array<{ tags: string[]; source: string }>
): {
  total: number;
  curated: number;
  heuristic: number;
  /**
   * Requirements nothing classified — holding `core` by fallback alone. This is
   * the number that used to be invisible: these rows are asked as security
   * questions, and before the 'uncurated' stamp they were indistinguishable
   * from requirements a human had placed there.
   */
  uncurated: number;
  untagged: number;
  core_tagged: number;
  curated_pct: number;
} {
  const total = rows.length;
  const curated = rows.filter((r) => r.source === "curated").length;
  const heuristic = rows.filter((r) => r.source === "heuristic").length;
  const uncurated = rows.filter((r) => r.source === "uncurated").length;
  const untagged = rows.filter((r) => r.tags.length === 0).length;
  const core = rows.filter((r) => r.tags.includes("core")).length;
  return {
    total,
    curated,
    heuristic,
    uncurated,
    untagged,
    core_tagged: core,
    curated_pct: total > 0 ? Math.round((curated / total) * 100) : 0,
  };
}
