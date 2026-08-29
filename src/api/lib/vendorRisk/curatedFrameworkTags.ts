/**
 * curatedFrameworkTags.ts — version-controlled scope-tag curation for the
 * shipped regulatory framework templates.
 *
 * ── The defect this exists to fix ────────────────────────────────────────────
 * `deriveScopeTags` is a keyword heuristic written against CONTROL-style titles
 * ("Access Control Policy", "Cryptographic Protection"). Regulatory and AI
 * frameworks do not write titles that way. Measured against the three templates
 * curated here, the heuristic produced:
 *
 *   - NIST AI RMF: 4 of 4 requirements fell through every pattern to the `core`
 *     fallback. Activating the AI framework therefore left the AI domain EMPTY
 *     while adding four requirements to the security question set. A platform
 *     that ships an AI-governance framework and then asks its four functions as
 *     security questions is not doing AI governance.
 *   - CCPA/CPRA: 6 of 8 fell back ("Right to Delete Personal Information" does
 *     not contain the word "deletion"; "Personal Information" is not the
 *     "personal data" the pattern looks for).
 *   - GDPR: 3 of 12 fell back, and one was actively mis-classified —
 *     "Transparency and Privacy Notices" matched the `/\btransparen/i` pattern
 *     for `explainability`, an AI tag, so a GDPR privacy-notice article was
 *     asked as an AI question (AI outranks privacy in DOMAIN_PRECEDENCE).
 *
 * 11 of the 24 landed in the security domain by fallback, where they were
 * indistinguishable from a requirement a human had deliberately classified as
 * security. That indistinguishability is the deeper defect: `core` is a real
 * classification AND the fallback, so "nobody has looked at this" and "someone
 * decided this is baseline security" were the same value.
 *
 * ── What this module is ──────────────────────────────────────────────────────
 * Reference data, version-controlled and reviewable, keyed by the CANONICAL
 * template identity (`FRAMEWORK_TEMPLATES` key) and the STABLE requirement
 * `reference_id` — never by database id, framework name string, or row order,
 * so it survives re-activation, renaming, and re-seeding.
 *
 * Each entry carries the tags, the DOMAIN the curator intends the requirement to
 * be asked under, and why. The intended domain is not decoration: a test asserts
 * `domainForScopeTags(entry.tags) === entry.domain` for every entry, so a tag
 * edit that silently moves a requirement between question sets fails CI instead
 * of quietly changing what vendors are asked.
 *
 * ── Deliberate security is explicit ──────────────────────────────────────────
 * Two entries here ARE security requirements — GDPR Art-32 and CCPA-8 are the
 * security obligations that sit inside privacy laws. They are marked
 * `deliberate_security: true`. The distinction this module enforces is between
 * "a human classified this as security" and "no rule matched, so it defaulted
 * to security"; the second is now stamped `uncurated` (see
 * `requirementScopeTags.ts`), never silently merged into the first.
 *
 * ── Scope, stated ────────────────────────────────────────────────────────────
 * Three templates: `gdpr`, `ccpa`, `nist_ai_rmf`. The SOC 2 / NIST CSF corpus
 * already in the field is NOT curated here — it is under-tagged in ways that
 * would change what existing security questionnaires ask on re-resolve, so it
 * needs its own regression analysis. Tracked as a separate reference-data
 * curation follow-up.
 *
 * Three vocabulary tags find no home in these templates and are deliberately
 * NOT forced onto a requirement to make them look used:
 *   - `cross-border` — the GDPR template has no Chapter V (Art 44–49
 *     international transfers) requirement to carry it;
 *   - `model-provider`, `explainability` — the NIST AI RMF template carries the
 *     four top-level functions only, not the subcategories where third-party
 *     model provenance and interpretability live.
 * Those are template CONTENT gaps, recorded rather than papered over with a tag
 * whose requirement does not exist.
 */

import type { AssessmentDomain } from "./requirementDomain.js";
import { domainForScopeTags } from "./requirementDomain.js";
import type { ScopeTag, ScopeTagSource } from "./requirementScopeTags.js";
import { deriveScopeTags } from "./requirementScopeTags.js";

export type CuratedRequirementTagging = {
  /** Tags a curator stands behind. Every one is in `SCOPE_TAG_VOCABULARY`. */
  readonly tags: readonly ScopeTag[];
  /** The domain this requirement is intended to be asked under. Test-asserted. */
  readonly domain: AssessmentDomain;
  /** Why these tags — the curator's reasoning, for the next reviewer. */
  readonly why: string;
  /**
   * Set only where the curated domain is `security` ON PURPOSE. Its absence on
   * a `security` entry is a curation bug, and a test says so.
   */
  readonly deliberate_security?: true;
};

/**
 * template key → stable reference_id → curation.
 *
 * A test asserts this covers each listed template EXACTLY: every template
 * requirement has an entry, and every entry names a requirement that exists.
 * Adding a requirement to a curated template without curating it fails CI —
 * which is the point, because the alternative is it silently becoming a
 * security question.
 */
export const CURATED_FRAMEWORK_TAGS: Readonly<
  Record<string, Readonly<Record<string, CuratedRequirementTagging>>>
> = {
  gdpr: {
    "Art-5": {
      tags: ["privacy", "data-protection", "retention"],
      domain: "privacy",
      why: "The processing principles: lawfulness and fairness, purpose limitation, accuracy, storage limitation (retention), and integrity/confidentiality (data-protection).",
    },
    "Art-6": {
      tags: ["privacy", "lawful-basis"],
      domain: "privacy",
      why: "Art 6 IS the lawful-basis requirement. The heuristic has no pattern for it — 'Lawfulness of Processing' matched nothing and fell back to core.",
    },
    "Art-7": {
      tags: ["privacy", "lawful-basis"],
      domain: "privacy",
      why: "Consent is one lawful basis, with its own conditions (freely given, withdrawable).",
    },
    "Art-12-14": {
      tags: ["privacy", "data-subject-rights"],
      domain: "privacy",
      why: "Transparency TO THE DATA SUBJECT and privacy notices. Explicitly NOT `explainability`: the heuristic's /transparen/ pattern is an AI-interpretability tag and pushed this article into the AI domain.",
    },
    "Art-15-22": {
      tags: ["privacy", "data-subject-rights"],
      domain: "privacy",
      why: "Access, rectification, erasure, restriction, portability, objection — the data-subject rights themselves.",
    },
    "Art-24-25": {
      tags: ["privacy", "data-protection", "secure-development"],
      domain: "privacy",
      why: "Data protection by design and by default is a privacy requirement discharged through the development lifecycle, so it carries `secure-development` and is reachable from the security question set too.",
    },
    "Art-28": {
      tags: ["supply-chain", "subprocessor"],
      domain: "nth_party",
      why: "Processor agreements (DPAs) are third-party governance. Deliberately NOT tagged `privacy`: privacy outranks nth_party in DOMAIN_PRECEDENCE, and filing the platform's clearest sub-processor requirement under privacy would leave the nth-party question set without it.",
    },
    "Art-30": {
      tags: ["privacy", "data-protection"],
      domain: "privacy",
      why: "Records of processing activities — the RoPA inventory of what personal data is processed and why.",
    },
    "Art-32": {
      tags: ["core", "encryption", "access-control"],
      domain: "security",
      deliberate_security: true,
      why: "Security of processing is the security obligation inside GDPR. Its own text names encryption, pseudonymisation and access control. Classified security by decision, not by fallback.",
    },
    "Art-33-34": {
      tags: ["privacy", "breach-notification", "incident-response"],
      domain: "privacy",
      why: "The 72-hour personal-data-breach notification duty. Carries `incident-response` so the security question set reaches it, but it is asked as a privacy obligation.",
    },
    "Art-35-36": {
      tags: ["privacy", "data-protection"],
      domain: "privacy",
      why: "DPIAs for high-risk processing, and prior consultation with the supervisory authority.",
    },
    "Art-37-39": {
      tags: ["privacy"],
      domain: "privacy",
      why: "The Data Protection Officer: appointment, position and tasks.",
    },
  },

  ccpa: {
    "CCPA-1": {
      tags: ["privacy", "data-subject-rights"],
      domain: "privacy",
      why: "Right to know what personal information was collected and whether it was sold.",
    },
    "CCPA-2": {
      tags: ["privacy", "data-subject-rights", "retention"],
      domain: "privacy",
      why: "Right to deletion, including onward direction to service providers — a deletion duty is a retention duty.",
    },
    "CCPA-3": {
      tags: ["privacy", "data-subject-rights"],
      domain: "privacy",
      why: "Right to opt out of sale or sharing.",
    },
    "CCPA-4": {
      tags: ["privacy", "data-subject-rights"],
      domain: "privacy",
      why: "Right to non-discrimination for exercising CCPA rights.",
    },
    "CCPA-5": {
      tags: ["privacy", "data-subject-rights"],
      domain: "privacy",
      why: "Right to correct inaccurate personal information.",
    },
    "CCPA-6": {
      tags: ["privacy", "data-subject-rights", "data-protection"],
      domain: "privacy",
      why: "Right to limit use of SENSITIVE personal information — a rights requirement with a data-classification dependency.",
    },
    "CCPA-7": {
      tags: ["privacy", "data-subject-rights"],
      domain: "privacy",
      why: "Privacy notice and disclosure requirements — what must be told to consumers, and their rights.",
    },
    "CCPA-8": {
      tags: ["core"],
      domain: "security",
      deliberate_security: true,
      why: "The 'reasonable security procedures' duty is the security obligation inside CCPA, and belongs in the baseline security set rather than the privacy question set. Classified security by decision; the `curated` source is what distinguishes this from the 6 CCPA requirements that USED to reach the same domain by fallback.",
    },
  },

  nist_ai_rmf: {
    GOVERN: {
      tags: ["ai-governance", "human-oversight"],
      domain: "ai",
      why: "Organisational AI governance: policy, accountability structures, defined oversight roles, and an inventory of AI systems in use.",
    },
    MAP: {
      tags: ["ai-governance", "model-risk", "automated-decision"],
      domain: "ai",
      why: "Categorising AI risk in context — who could be harmed, WHAT DECISIONS ARE AUTOMATED, and what the failure modes are.",
    },
    MEASURE: {
      tags: ["ai-governance", "model-risk", "training-data"],
      domain: "ai",
      why: "Testing and evaluation for accuracy, robustness and bias. Bias evaluation is a training-data property, which is why `training-data` is here and not on the other three.",
    },
    MANAGE: {
      tags: ["ai-governance", "model-risk", "human-oversight"],
      domain: "ai",
      why: "Risk treatment: mitigation, adjusting or decommissioning systems, an AI incident log, and a human review cycle over residual risk.",
    },
  },
};

/** The template keys this module curates. */
export const CURATED_TEMPLATE_KEYS = Object.keys(CURATED_FRAMEWORK_TAGS);

/** Is this template curated end to end? */
export function isCuratedTemplate(templateKey: string): boolean {
  return Object.prototype.hasOwnProperty.call(CURATED_FRAMEWORK_TAGS, templateKey);
}

/** The curation for one requirement, or null when it is not curated. */
export function curatedTaggingFor(
  templateKey: string | null | undefined,
  referenceId: string
): CuratedRequirementTagging | null {
  if (!templateKey) return null;
  const template = CURATED_FRAMEWORK_TAGS[templateKey];
  if (!template) return null;
  return template[referenceId] ?? null;
}

export type ResolvedScopeTags = {
  tags: ScopeTag[];
  source: ScopeTagSource;
  /**
   * True when NOTHING classified this requirement — no curation, no heuristic
   * pattern — and it holds `core` only because the fallback put it there.
   * Persisted as `scope_tags_source = 'uncurated'`.
   */
  uncurated: boolean;
};

/**
 * The one way a requirement acquires tags. Precedence:
 *
 *   1. CURATED reference data      → source 'curated'
 *   2. heuristic pattern match     → source 'heuristic'
 *   3. nothing matched             → `core` fallback, source 'uncurated'
 *
 * Step 3 keeps the tag and changes only what we CLAIM about it. `core` is the
 * entire tier-4 baseline, so dropping it would empty low-risk questionnaires —
 * the fallback stays. What ends is pretending it was a classification.
 */
export function resolveScopeTags(args: {
  templateKey?: string | null;
  reference_id: string;
  title: string;
  description?: string | null;
}): ResolvedScopeTags {
  const curated = curatedTaggingFor(args.templateKey, args.reference_id);
  if (curated) {
    return { tags: [...curated.tags].sort(), source: "curated", uncurated: false };
  }

  const derived = deriveScopeTags({
    reference_id: args.reference_id,
    title: args.title,
    description: args.description ?? null,
  });

  return {
    tags: derived.tags,
    source: derived.fallback_applied ? "uncurated" : "heuristic",
    uncurated: derived.fallback_applied,
  };
}

/** The domain a curated entry resolves to. Exported so tests can assert intent. */
export function curatedDomain(entry: CuratedRequirementTagging): AssessmentDomain {
  return domainForScopeTags(entry.tags);
}
