/**
 * factRegistry.ts — the closed, versioned registry of facts the deterministic
 * policy layer may read (VA-Q2 P1; VA-Q0 §6.1; ADR-0013 R2, R4).
 *
 * PURE. No I/O. This file is the ONLY place a fact key is defined. A key that
 * is not here cannot be stored (P3's writer calls `validateFact`), cannot be
 * referenced by a rule (rules index `FACT_REGISTRY` by key), and cannot come
 * from a source the registry does not allow for it.
 *
 * ── Subjects, not engagements (owner decision D1, 2026-08-28 = Option B) ──
 *
 * Facts are addressed by a SUBJECT — `(subject_type, subject_id)` — not by an
 * engagement. Q2 writes only `vendor_engagement`; `vendor`, `ai_system`,
 * `asset` and `organization` are reserved so the posture and AI-governance
 * layers can declare facts through the same registry later WITHOUT a rename.
 * Nothing in the registry or the resolver assumes the subject is an
 * engagement; the engagement is simply the first subject type.
 *
 * ── Two axes: `source` (trust class) and `origin` (mechanism) ────────────
 *
 * VA-Q0 §6.1 ranks precedence over six MECHANISMS — how the value reached the
 * store. The owner's D1 ruling names five TRUST CLASSES — who asserted it.
 * Collapsing one into the other loses information (three of Q0's mechanisms
 * would all be `system_derived`, and the precedence order with them), so P3
 * keeps both, with a closed table of allowed pairs (VA-Q2 plan §J conflict 2):
 *
 *   origin (mechanism, Q0 §6.1 — precedence is ranked over THIS axis):
 *     vendor_answer (this engagement, most recent)
 *       > intake > ai_system_dependency > vendor_profile > profile_default
 *     `derived` is computed by the platform from org configuration
 *     (`policy.*`); it has no rank because it never competes for a key.
 *
 *   source (trust class, D1 — authority rules are stated over THIS axis):
 *     intake · internal_user · system_derived · vendor_response · ai_extraction
 *
 * A `vendor_answer` outranks `intake` ONLY in the widening direction: the
 * resolver (`factResolver.ts`) never lets a vendor value narrow what an
 * internal source declared (ADR-0013 R4, VA-Q0 §12 T-6). Precedence and the
 * widen-only rule are two different things and both are tested.
 *
 * ── AI is never authoritative without the human boundary ─────────────────
 *
 * `ai_extraction` IS a trust class (so a model's proposal is stored WITH its
 * provenance, never laundered under a human source) — but a row from it is
 * born `proposed` and reaches `accepted` only through the governed
 * human-accept boundary (trigger-enforced, 20261063). `resolveFacts` reads
 * `accepted` rows only, so an AI-derived value is never a fact a rule can
 * fire on until a human accepted it. `aiMayBeAuthoritative` is `false` for
 * every key: the human accept is the only path, and it is not a registry
 * property a later edit could flip.
 *
 * ── Versioning ───────────────────────────────────────────────────────────
 *
 * The registry is part of the scope-rule corpus: any change here bumps
 * `SCOPE_RULE_VERSION` (`methodologyVersion.ts`). `FACT_REGISTRY_VERSION` is
 * that same constant, exported under the name the design uses.
 */

import { SCOPE_RULE_VERSION } from "./methodologyVersion.js";
import {
  ACCESS_LEVELS,
  AI_AUTONOMY_LEVELS,
  AI_INVOLVEMENT_LEVELS,
  BUSINESS_CRITICALITY_LEVELS,
  CONCENTRATION_LEVELS,
  DATA_SENSITIVITY_LEVELS,
  DATA_VOLUME_BANDS,
  FOURTH_PARTY_LEVELS,
  HOSTING_MODELS,
  OPERATIONAL_DEPENDENCY_LEVELS,
  RECOVERABILITY_LEVELS,
  REGULATORY_EXPOSURE_LEVELS,
} from "./inherentRisk.js";
import { ASSESSMENT_DOMAINS, type AssessmentDomain } from "./requirementDomain.js";
import {
  FACT_SUBJECT_TYPES,
  RESERVED_FACT_SUBJECT_TYPES,
  isFactSubjectType,
  type FactSubjectRef,
  type FactSubjectType,
} from "./factSubjects.js";

export const FACT_REGISTRY_VERSION = SCOPE_RULE_VERSION;

// ── Subjects ────────────────────────────────────────────────────────────────
// The closed allowlist lives in factSubjects.ts (with the per-type resolvers);
// re-exported here so registry consumers keep one import.

export { FACT_SUBJECT_TYPES, RESERVED_FACT_SUBJECT_TYPES, isFactSubjectType };
export type { FactSubjectType };
export type FactSubject = FactSubjectRef;

// ── Origins (mechanism — VA-Q0 §6.1 vocabulary, unchanged) ─────────────────

export const FACT_ORIGINS = [
  "intake",
  "vendor_profile",
  "ai_system_dependency",
  "vendor_answer",
  "profile_default",
  "derived",
] as const;
export type FactOrigin = (typeof FACT_ORIGINS)[number];

/** Highest precedence first (VA-Q0 §6.1). `derived` is outside the contest. */
export const ORIGIN_PRECEDENCE: readonly FactOrigin[] = [
  "vendor_answer",
  "intake",
  "ai_system_dependency",
  "vendor_profile",
  "profile_default",
];

/**
 * Origins whose values are VERIFIED in ADR-0013 R4's sense — declared or
 * confirmed by SecureLogic's customer or derived by the platform from its
 * canonical rows, not asserted by the vendor being assessed. Only these may
 * narrow a future reassessment; a vendor answer may only widen.
 */
export const INTERNAL_FACT_ORIGINS: readonly FactOrigin[] = [
  "intake",
  "vendor_profile",
  "ai_system_dependency",
  "profile_default",
  "derived",
];

export function isFactOrigin(value: unknown): value is FactOrigin {
  return typeof value === "string" && (FACT_ORIGINS as readonly string[]).includes(value);
}

export function isInternalOrigin(origin: FactOrigin): boolean {
  return INTERNAL_FACT_ORIGINS.includes(origin);
}

/** True when origin `a` outranks origin `b`. Neither may be `derived`. */
export function outranks(a: FactOrigin, b: FactOrigin): boolean {
  const ia = ORIGIN_PRECEDENCE.indexOf(a);
  const ib = ORIGIN_PRECEDENCE.indexOf(b);
  if (ia < 0 || ib < 0) return false;
  return ia < ib;
}

// ── Sources (trust class — owner D1 vocabulary) ─────────────────────────────

export const FACT_SOURCES = [
  "intake",
  "vendor_response",
  "ai_extraction",
  "internal_user",
  "system_derived",
] as const;
export type FactSource = (typeof FACT_SOURCES)[number];

/** The one AI trust class. Rows from it are born `proposed`; see the header. */
export const AI_FACT_SOURCE: FactSource = "ai_extraction";

/**
 * Sources whose rows are INTERNAL — asserted by the customer or derived by
 * the platform from canonical rows. The reassessment view (`verifiedOnly`)
 * reads these only: a vendor assertion or an AI proposal can never be the
 * fact that narrows (VA-Q0 §6.1 clarification, ADR-0013 R4).
 */
export const INTERNAL_FACT_SOURCES: readonly FactSource[] = ["intake", "internal_user", "system_derived"];

/** Sources that may carry `verified_at` — internal verification only (DB CHECK mirrors this). */
export const VERIFYING_FACT_SOURCES: readonly FactSource[] = ["intake", "internal_user"];

export function isFactSource(value: unknown): value is FactSource {
  return typeof value === "string" && (FACT_SOURCES as readonly string[]).includes(value);
}

export function isInternalSource(source: FactSource): boolean {
  return INTERNAL_FACT_SOURCES.includes(source);
}

/**
 * Allowed `(source, origin)` pairs — mirrored by the DB CHECK in 20261063 and
 * lockstep-tested. A pair outside this table is a provenance lie (a human
 * cannot have "mirrored" a profile flag; a model cannot have been "intake").
 */
export const ALLOWED_SOURCE_ORIGIN_PAIRS: Readonly<Record<FactSource, readonly FactOrigin[]>> = {
  intake: ["intake"],
  internal_user: ["intake"],
  system_derived: ["vendor_profile", "ai_system_dependency", "profile_default", "derived"],
  vendor_response: ["vendor_answer"],
  ai_extraction: ["derived"],
};

export function isAllowedSourceOrigin(source: FactSource, origin: FactOrigin): boolean {
  return ALLOWED_SOURCE_ORIGIN_PAIRS[source].includes(origin);
}

// ── Fact shapes ─────────────────────────────────────────────────────────────

export type FactValue = boolean | string | readonly string[];

/**
 * The widening direction of a fact — what "a vendor answer may only widen"
 * means for this value type (ADR-0013 R4):
 *
 *   bool      `true` widens (every S5 clause activates on `true`);
 *   ranked    a HIGHER rank widens;
 *   enum[]/string[]  a SUPERSET widens (values can be added, never removed);
 *   enum      no order exists, so a vendor answer never overrides an
 *             internal value at all.
 */
export type FactSpec =
  | { type: "bool"; origins: readonly FactOrigin[]; domains: readonly AssessmentDomain[] }
  | { type: "enum"; values: readonly string[]; origins: readonly FactOrigin[]; domains: readonly AssessmentDomain[] }
  | { type: "enum[]"; values: readonly string[]; origins: readonly FactOrigin[]; domains: readonly AssessmentDomain[] }
  | { type: "string[]"; pattern?: RegExp; origins: readonly FactOrigin[]; domains: readonly AssessmentDomain[] }
  | { type: "ranked"; ranked: readonly string[]; origins: readonly FactOrigin[]; domains: readonly AssessmentDomain[] };

export type FactType = FactSpec["type"];

const INTAKE_ONLY: readonly FactOrigin[] = ["intake"];
const INTAKE_OR_PROFILE: readonly FactOrigin[] = ["intake", "vendor_profile", "profile_default"];
const INTAKE_THEN_VENDOR: readonly FactOrigin[] = ["intake", "vendor_answer", "profile_default"];
const AI_ORIGINS: readonly FactOrigin[] = ["intake", "ai_system_dependency", "vendor_profile", "vendor_answer", "profile_default"];
const DERIVED_ONLY: readonly FactOrigin[] = ["derived"];

const D = (...d: AssessmentDomain[]): readonly AssessmentDomain[] => d;

/** Fact keys are dotted lowercase paths, mirroring P3's DB CHECK. */
export const FACT_KEY_PATTERN = /^[a-z]+(\.[a-z_]+)+$/;

/**
 * THE registry. `core.*` entries reference the `inherentRisk.ts` vocabularies
 * — never a second copy — so the two can never drift.
 */
export const FACT_REGISTRY = {
  // core.* — the 13 inherent inputs, mirrored from vendor_engagements (VA-Q0 §4.3)
  "core.data_sensitivity": { type: "ranked", ranked: DATA_SENSITIVITY_LEVELS, origins: INTAKE_ONLY, domains: D("privacy") },
  "core.data_volume": { type: "ranked", ranked: DATA_VOLUME_BANDS, origins: INTAKE_ONLY, domains: D("privacy") },
  "core.access_level": { type: "ranked", ranked: ACCESS_LEVELS, origins: INTAKE_ONLY, domains: D("security") },
  "core.operational_dependency": { type: "ranked", ranked: OPERATIONAL_DEPENDENCY_LEVELS, origins: INTAKE_ONLY, domains: D("resilience") },
  "core.recoverability": { type: "ranked", ranked: RECOVERABILITY_LEVELS, origins: INTAKE_ONLY, domains: D("resilience") },
  "core.business_criticality": { type: "ranked", ranked: BUSINESS_CRITICALITY_LEVELS, origins: INTAKE_ONLY, domains: D("resilience") },
  "core.regulatory_exposure": { type: "ranked", ranked: REGULATORY_EXPOSURE_LEVELS, origins: INTAKE_ONLY, domains: D("compliance") },
  "core.regulatory_breach_notification": { type: "bool", origins: INTAKE_ONLY, domains: D("compliance") },
  "core.ai_involvement": { type: "ranked", ranked: AI_INVOLVEMENT_LEVELS, origins: INTAKE_ONLY, domains: D("ai") },
  "core.ai_autonomy": { type: "ranked", ranked: AI_AUTONOMY_LEVELS, origins: INTAKE_ONLY, domains: D("ai") },
  "core.hosting_model": { type: "ranked", ranked: HOSTING_MODELS, origins: INTAKE_ONLY, domains: D("security") },
  "core.fourth_party_exposure": { type: "ranked", ranked: FOURTH_PARTY_LEVELS, origins: INTAKE_ONLY, domains: D("nth_party") },
  "core.concentration": { type: "ranked", ranked: CONCENTRATION_LEVELS, origins: INTAKE_ONLY, domains: D("nth_party") },

  // service.*
  "service.type": { type: "enum", values: ["saas", "managed_service", "professional_services", "software", "hardware", "data_provider", "other"], origins: INTAKE_OR_PROFILE, domains: D("security") },
  "service.customer_facing": { type: "bool", origins: INTAKE_OR_PROFILE, domains: D("security") },
  "service.hosting_regions": { type: "string[]", pattern: /^[A-Z]{2}$/, origins: INTAKE_OR_PROFILE, domains: D("privacy") },

  // data.* — intake, then vendor answers
  "data.personal_data": { type: "bool", origins: ["intake", "vendor_profile", "vendor_answer", "profile_default"], domains: D("privacy") },
  "data.categories": { type: "enum[]", values: ["identifiers", "contact", "financial", "employment", "behavioural", "location", "credentials", "content"], origins: INTAKE_THEN_VENDOR, domains: D("privacy") },
  "data.sensitive_categories": { type: "enum[]", values: ["health", "biometric", "genetic", "racial_ethnic", "political", "religious", "sexual", "criminal", "children"], origins: INTAKE_THEN_VENDOR, domains: D("privacy") },
  "data.subjects": { type: "enum[]", values: ["customers", "employees", "patients", "children", "end_users", "public"], origins: INTAKE_THEN_VENDOR, domains: D("privacy") },
  "data.volume_band": { type: "ranked", ranked: DATA_VOLUME_BANDS, origins: INTAKE_THEN_VENDOR, domains: D("privacy") },
  "data.jurisdictions": { type: "string[]", pattern: /^[A-Z]{2}$/, origins: INTAKE_THEN_VENDOR, domains: D("privacy", "compliance") },
  "data.cross_border": { type: "bool", origins: INTAKE_THEN_VENDOR, domains: D("privacy") },
  "data.retention_defined": { type: "bool", origins: INTAKE_THEN_VENDOR, domains: D("privacy") },

  // access.* — intake only
  "access.privileged": { type: "bool", origins: INTAKE_ONLY, domains: D("security") },
  "access.network": { type: "bool", origins: INTAKE_ONLY, domains: D("security") },
  "access.production_data": { type: "bool", origins: INTAKE_ONLY, domains: D("security", "privacy") },

  // ai.* — intake, ai_system_vendor_dependencies, vendor answers
  "ai.uses_ai": { type: "bool", origins: AI_ORIGINS, domains: D("ai") },
  "ai.use_cases": { type: "enum[]", values: ["classification", "generation", "recommendation", "prediction", "automation", "search", "assistant", "other"], origins: AI_ORIGINS, domains: D("ai") },
  "ai.customer_facing": { type: "bool", origins: AI_ORIGINS, domains: D("ai") },
  "ai.generative": { type: "bool", origins: AI_ORIGINS, domains: D("ai") },
  "ai.third_party_models": { type: "bool", origins: AI_ORIGINS, domains: D("ai", "nth_party") },
  "ai.model_providers": { type: "string[]", origins: AI_ORIGINS, domains: D("ai", "nth_party") },
  "ai.customer_data_in_prompts": { type: "bool", origins: AI_ORIGINS, domains: D("ai", "privacy") },
  "ai.trains_on_customer_data": { type: "bool", origins: ["intake", "vendor_answer"], domains: D("ai", "privacy") },
  "ai.fine_tunes_on_customer_data": { type: "bool", origins: ["intake", "vendor_answer"], domains: D("ai", "privacy") },
  "ai.automated_decisions": { type: "bool", origins: AI_ORIGINS, domains: D("ai", "privacy") },
  "ai.material_decisions": { type: "bool", origins: AI_ORIGINS, domains: D("ai", "privacy") },
  "ai.retention_of_inputs": { type: "enum", values: ["none", "transient", "bounded", "indefinite", "unknown"], origins: AI_ORIGINS, domains: D("ai", "privacy") },

  // nth.* — intake, vendor answers
  "nth.subprocessors_declared": { type: "bool", origins: INTAKE_THEN_VENDOR, domains: D("nth_party") },
  "nth.subprocessor_count_band": { type: "ranked", ranked: ["none", "few", "several", "many"], origins: INTAKE_THEN_VENDOR, domains: D("nth_party") },
  "nth.subprocessors_in_scope_regions": { type: "bool", origins: INTAKE_THEN_VENDOR, domains: D("nth_party", "privacy") },
  "nth.concentration": { type: "ranked", ranked: CONCENTRATION_LEVELS, origins: INTAKE_THEN_VENDOR, domains: D("nth_party") },

  // policy.* — org configuration, platform-derived only. NEVER from a vendor.
  "policy.frameworks_active": { type: "string[]", origins: DERIVED_ONLY, domains: D("compliance") },
  "policy.obligations_active": { type: "string[]", origins: DERIVED_ONLY, domains: D("compliance") },
  "policy.privacy_obligations_active": { type: "string[]", origins: DERIVED_ONLY, domains: D("privacy", "compliance") },
  "policy.profile_key": { type: "enum", values: ["securelogic_default"], origins: DERIVED_ONLY, domains: D("security") },
} as const satisfies Record<string, FactSpec>;

export type FactKey = keyof typeof FACT_REGISTRY;
export const FACT_KEYS = Object.keys(FACT_REGISTRY) as readonly FactKey[];

export function isFactKey(value: unknown): value is FactKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(FACT_REGISTRY, value);
}

export function factSpec(key: FactKey): FactSpec {
  return FACT_REGISTRY[key];
}

/** True when a vendor's answer is an allowed origin for this key — i.e. the vendor may widen it. */
export function vendorMayWiden(key: FactKey): boolean {
  return (FACT_REGISTRY[key].origins as readonly FactOrigin[]).includes("vendor_answer");
}

/**
 * Whether an AI-derived value may ever be authoritative for this key. Always
 * `false`; a function rather than a constant so the property is visible at
 * every call site that asks, and so a test can iterate every key.
 */
export function aiMayBeAuthoritative(_key: FactKey): false {
  return false;
}

/** Rank of a ranked value (0 = lowest); -1 when the key is not ranked or the value is unknown. */
export function factRank(key: FactKey, value: unknown): number {
  const spec: FactSpec = FACT_REGISTRY[key];
  if (spec.type !== "ranked" || typeof value !== "string") return -1;
  return spec.ranked.indexOf(value);
}

export type FactStatus = "proposed" | "accepted" | "superseded" | "rejected";
export const FACT_STATUSES: readonly FactStatus[] = ["proposed", "accepted", "superseded", "rejected"];

/**
 * A stored/loaded fact row — subject-addressed (D1 option B), not
 * engagement-keyed. Carries BOTH axes. `status` is absent on the in-memory
 * mirror (`factsFromInherent`), which is accepted by construction; a row
 * loaded from `assessment_facts` always carries it, and the resolver reads
 * `accepted` rows only.
 */
export type FactRow = {
  fact_key: string;
  value: unknown;
  /** Trust class — who asserted it. */
  source: string;
  /** Mechanism — how it reached the store; precedence ranks over this. */
  origin: string;
  status?: FactStatus | string;
  /** Present on rows loaded from the store; absent on the in-memory mirror. */
  subject?: FactSubject;
  /** ISO timestamp or Date; used to pick the most recent `vendor_answer`. */
  observed_at?: string | Date;
  verified_at?: string | Date | null;
  id?: string;
  supersedes_id?: string | null;
};

/**
 * What a model may hand back: a PROPOSAL, deliberately a different type from
 * `FactRow`. It has no `origin` and no `status`, so it cannot enter
 * `resolveFacts`; it is persisted (by Q6's writer, not Q2) as an
 * `ai_extraction` row born `proposed`, and becomes a fact a rule can read
 * only when a human accepts it.
 */
export type FactProposal = {
  fact_key: string;
  proposed_value: unknown;
  proposed_by: "ai_extraction";
  rationale: string;
};

// ── Validation ──────────────────────────────────────────────────────────────

export type FactValidationError = {
  field: "fact_key" | "value" | "source" | "origin" | "subject_type";
  reason: string;
};

export type FactValidation =
  | { ok: true; key: FactKey; value: FactValue; source: FactSource; origin: FactOrigin }
  | { ok: false; errors: FactValidationError[] };

function validateValue(spec: FactSpec, value: unknown): string | null {
  switch (spec.type) {
    case "bool":
      return typeof value === "boolean" ? null : "must be a boolean";
    case "enum":
      if (typeof value !== "string") return "must be a string";
      return spec.values.includes(value) ? null : `must be one of: ${spec.values.join(", ")}`;
    case "ranked":
      if (typeof value !== "string") return "must be a string";
      return spec.ranked.includes(value) ? null : `must be one of: ${spec.ranked.join(", ")}`;
    case "enum[]": {
      if (!Array.isArray(value)) return "must be an array";
      if (value.length > 50) return "must have at most 50 entries";
      const seen = new Set<string>();
      for (const v of value) {
        if (typeof v !== "string" || !spec.values.includes(v)) return `every entry must be one of: ${spec.values.join(", ")}`;
        if (seen.has(v)) return "entries must be unique";
        seen.add(v);
      }
      return null;
    }
    case "string[]": {
      if (!Array.isArray(value)) return "must be an array";
      if (value.length > 200) return "must have at most 200 entries";
      for (const v of value) {
        if (typeof v !== "string" || v.length === 0 || v.length > 200) return "every entry must be a non-empty string of at most 200 characters";
        if (spec.pattern && !spec.pattern.test(v)) return `every entry must match ${spec.pattern.source}`;
      }
      return null;
    }
  }
}

/**
 * The gate every writer calls (P3's route, the mirrors, any future
 * `ai_system`/`vendor` writer). Rejects unregistered keys, malformed values,
 * a source outside the five trust classes, an origin the registry does not
 * allow for the key, a `(source, origin)` pair outside the allowed table, and
 * — when given — a subject type outside the ACTIVE allowlist (reserved types
 * included). Errors name the field, so a 400 can echo them verbatim.
 *
 * Note what this does NOT decide: whether an `ai_extraction` row may be READ.
 * That is `status`, enforced by the store and honoured by the resolver.
 */
export function validateFact(
  key: unknown,
  value: unknown,
  source: unknown,
  origin: unknown,
  subjectType?: unknown
): FactValidation {
  const errors: FactValidationError[] = [];

  if (typeof key !== "string" || !FACT_KEY_PATTERN.test(key)) {
    errors.push({ field: "fact_key", reason: "must be a dotted lowercase key such as data.personal_data" });
  } else if (!isFactKey(key)) {
    errors.push({ field: "fact_key", reason: `unregistered fact key (registry ${FACT_REGISTRY_VERSION})` });
  }

  if (!isFactSource(source)) {
    errors.push({ field: "source", reason: `must be one of: ${FACT_SOURCES.join(", ")}` });
  }

  if (!isFactOrigin(origin)) {
    errors.push({ field: "origin", reason: `must be one of: ${FACT_ORIGINS.join(", ")}` });
  }

  if (subjectType !== undefined && !isFactSubjectType(subjectType)) {
    errors.push({ field: "subject_type", reason: `must be one of: ${FACT_SUBJECT_TYPES.join(", ")}` });
  }

  if (errors.length > 0) return { ok: false, errors };

  const k = key as FactKey;
  const s = source as FactSource;
  const o = origin as FactOrigin;
  const spec: FactSpec = FACT_REGISTRY[k];

  if (!spec.origins.includes(o)) {
    errors.push({ field: "origin", reason: `${k} may not come from ${o}; allowed: ${spec.origins.join(", ")}` });
  }
  if (!isAllowedSourceOrigin(s, o)) {
    errors.push({ field: "source", reason: `${s} cannot assert a fact via ${o}; allowed origins: ${ALLOWED_SOURCE_ORIGIN_PAIRS[s].join(", ")}` });
  }
  const valueError = validateValue(spec, value);
  if (valueError) errors.push({ field: "value", reason: `${k} ${valueError}` });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, key: k, value: value as FactValue, source: s, origin: o };
}

/** Every domain a fact can activate — closed over `ASSESSMENT_DOMAINS` by type; exported for tests. */
export const FACT_DOMAINS = ASSESSMENT_DOMAINS;
