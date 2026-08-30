/**
 * canonicalControlIdentity.ts - the canonical control key grammar and the
 * closed vocabularies that go with it.
 *
 * Every vocabulary here mirrors a CHECK constraint in migrations 20261067 /
 * 20261068 / 20261069. `canonicalControlIdentity.test.ts` reads those migration
 * files and asserts the two agree, so a value added on one side and forgotten
 * on the other fails CI instead of failing at runtime as a 23514.
 *
 * TEXT + CHECK + a lockstep test, not a Postgres ENUM. That is the pattern
 * every closed vocabulary in this schema already uses; there is no ENUM here to
 * be consistent with, and an ENUM cannot drop or reorder a value without a type
 * rewrite, which makes governed vocabulary evolution a migration hazard.
 */

/** Mirrors canonical_controls_key_grammar_check (20261067). */
export const CANONICAL_CONTROL_KEY_PATTERN =
  /^securelogic:control:[a-z0-9]+(-[a-z0-9]+)*$/;

export const CANONICAL_CONTROL_NAMESPACE = "securelogic:control:";

/** Mirrors canonical_controls_status_check (20261067). */
export const CANONICAL_CONTROL_STATUSES = ["draft", "published", "superseded"] as const;
export type CanonicalControlStatus = (typeof CANONICAL_CONTROL_STATUSES)[number];

/** Mirrors canonical_control_aliases_scheme_check (20261067). */
export const CANONICAL_CONTROL_ALIAS_SCHEMES = [
  "industry_template",
  "framework_reference",
  "legacy",
] as const;
export type CanonicalControlAliasScheme = (typeof CANONICAL_CONTROL_ALIAS_SCHEMES)[number];

/** Mirrors canonical_control_crosswalk_source_check (20261068). */
export const CROSSWALK_MAPPING_SOURCES = ["securelogic", "ai_proposed", "customer"] as const;
export type CrosswalkMappingSource = (typeof CROSSWALK_MAPPING_SOURCES)[number];

/** Mirrors canonical_control_crosswalk_status_check (20261068). */
export const CROSSWALK_STATUSES = ["proposed", "approved", "published", "superseded"] as const;
export type CrosswalkStatus = (typeof CROSSWALK_STATUSES)[number];

/** Mirrors canonical_control_crosswalk_actor_kind_check (20261068). */
export const CROSSWALK_ACTOR_KINDS = [
  "securelogic_curator",
  "ai_extraction",
  "customer",
] as const;
export type CrosswalkActorKind = (typeof CROSSWALK_ACTOR_KINDS)[number];

/** Mirrors control_canonical_identities_provenance_check (20261069). */
export const CONTROL_CANONICAL_PROVENANCE = [
  "attestation",
  "template",
  "customer_mapped",
  "inferred",
] as const;
export type ControlCanonicalProvenance = (typeof CONTROL_CANONICAL_PROVENANCE)[number];

/**
 * Provenance ranked by AUTHORITY, strongest first. A reader that must pick one
 * identity for a control ranks on this rather than letting a later write
 * clobber an earlier one - the same discipline `asset_product_identities` uses,
 * where human attestation wins because it sorts first, not because it
 * overwrote the machine's row.
 */
export const CONTROL_CANONICAL_PROVENANCE_AUTHORITY: readonly ControlCanonicalProvenance[] = [
  "attestation",
  "template",
  "customer_mapped",
  "inferred",
] as const;

export function isCanonicalControlKey(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_CONTROL_KEY_PATTERN.test(value);
}

/**
 * An alias may never be spelled in the canonical namespace. This mirrors
 * canonical_control_aliases_not_canonical_namespace_check and is what keeps
 * aliases from becoming a second, competing canonical identity.
 */
export function isLegalAliasKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !value.startsWith(CANONICAL_CONTROL_NAMESPACE)
  );
}

/** Build a canonical key from a slug, failing loudly on an illegal slug. */
export function canonicalControlKey(slug: string): string {
  const key = `${CANONICAL_CONTROL_NAMESPACE}${slug}`;
  if (!CANONICAL_CONTROL_KEY_PATTERN.test(key)) {
    throw new Error(`illegal canonical control slug: ${JSON.stringify(slug)}`);
  }
  return key;
}
