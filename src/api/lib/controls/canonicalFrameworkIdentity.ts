/**
 * canonicalFrameworkIdentity.ts - the versioned GLOBAL framework identity.
 *
 * -- The problem this exists to solve --------------------------------------
 *
 * The owner ruling approved a global requirement identity of
 *
 *     (framework_key, framework_version, requirement_reference)
 *
 * "provided repository inspection confirms these fields uniquely and
 * deterministically identify the versioned requirement". Inspection found they
 * did NOT, and this module plus migration 20261068 is what makes them.
 *
 * What was actually in the schema:
 *
 *   * `requirements` is UNIQUE (framework_id, reference_id) - a reference is
 *     unique WITHIN a framework row.
 *   * `frameworks` is UNIQUE (organization_id, name, version), and `name` is a
 *     free-text, user-editable DISPLAY string. There was no framework key.
 *   * Two stable key vocabularies existed in code and were discarded on the way
 *     into the database: `FRAMEWORK_TEMPLATES` keys (`soc2`, `nist_csf`, ...),
 *     used by POST /api/frameworks/activate, and `FRAMEWORK_REFS` keys
 *     (`nist-csf-2.0`, `soc2`, ...), used by templateLoader.
 *
 * Neither was persisted, so a global crosswalk keyed on a framework key could
 * not be joined back to a tenant requirement at all.
 *
 * -- Why a third vocabulary rather than adopting one of the two -------------
 *
 * Neither existing vocabulary can be the canonical one as it stands:
 *
 *   * `FRAMEWORK_TEMPLATES` keys carry no version - `nist_csf` means 1.1 today
 *     and would silently come to mean 2.0 if the template content were updated,
 *     which is precisely the historical-reconstruction failure the ruling
 *     forbids.
 *   * `FRAMEWORK_REFS` keys FUSE the version into the key (`nist-csf-2.0`), so
 *     a version bump looks like a different framework and the crosswalk for 1.1
 *     could never be recognised as the same framework's earlier content.
 *
 * The canonical identity separates them: a stable, version-free `framework_key`
 * plus an explicit `framework_version`. Both existing vocabularies map INTO it,
 * and nothing about them changes.
 *
 * -- This list MIRRORS db/migrations/20261068 -------------------------------
 *
 * Two implementations of one list is a duplication with a cost, and it is taken
 * deliberately for the same reason 20260926 took it: the migration must run
 * without an application boot, and this module must resolve identities for
 * frameworks created after the migration. `canonicalFrameworkIdentity.test.ts`
 * asserts the two agree, so drift fails CI rather than producing a crosswalk
 * that silently joins to nothing.
 *
 * Every (display_name, version) pair here is one this codebase actually writes
 * into `frameworks` - the FRAMEWORK_TEMPLATES entries and the FRAMEWORK_REFS
 * entries, both, because a tenant requirement can arrive by either path.
 */

export type CanonicalFrameworkIdentity = {
  /** Stable, lower-kebab, VERSION-FREE. 'nist-csf', never 'nist-csf-2.0'. */
  readonly framework_key: string;
  /** Verbatim as it is stored in `frameworks.version`. */
  readonly framework_version: string;
  /** Verbatim as it is stored in `frameworks.name`. */
  readonly display_name: string;
};

export const CANONICAL_FRAMEWORK_VERSIONS: readonly CanonicalFrameworkIdentity[] = [
  { framework_key: "soc2",                framework_version: "2017",  display_name: "SOC 2 Type II" },
  { framework_key: "nist-csf",            framework_version: "1.1",   display_name: "NIST Cybersecurity Framework" },
  { framework_key: "nist-csf",            framework_version: "2.0",   display_name: "NIST Cybersecurity Framework" },
  { framework_key: "iso-27001",           framework_version: "2022",  display_name: "ISO/IEC 27001" },
  { framework_key: "iso-42001",           framework_version: "2023",  display_name: "ISO/IEC 42001" },
  { framework_key: "hipaa-security-rule", framework_version: "2024",  display_name: "HIPAA Security Rule" },
  { framework_key: "pci-dss",             framework_version: "4.0",   display_name: "PCI DSS" },
  { framework_key: "pci-dss",             framework_version: "4.0.1", display_name: "PCI DSS" },
  { framework_key: "nist-sp-800-53",      framework_version: "Rev 5", display_name: "NIST SP 800-53" },
  { framework_key: "cis-controls",        framework_version: "v8",    display_name: "CIS Controls" },
  { framework_key: "gdpr",                framework_version: "2018",  display_name: "GDPR" },
  { framework_key: "ccpa-cpra",           framework_version: "2023",  display_name: "CCPA / CPRA" },
  { framework_key: "sox-it-controls",     framework_version: "2002",  display_name: "SOX IT Controls" },
  { framework_key: "dora",                framework_version: "2025",  display_name: "DORA" },
  { framework_key: "nist-ai-rmf",         framework_version: "1.0",   display_name: "NIST AI RMF" },
  { framework_key: "ny-dfs-23-nycrr-500", framework_version: "2024",  display_name: "NY DFS 23 NYCRR 500" },
  { framework_key: "eu-ai-act",           framework_version: "2024",  display_name: "EU AI Act" },
  { framework_key: "hitrust-csf",         framework_version: "11.0",  display_name: "HITRUST CSF" },
  // Assessment Composition v1 (20261088): SecureLogic's own presumptive baseline.
  { framework_key: "securelogic-core-assurance", framework_version: "1.0", display_name: "SecureLogic Core Assurance Set" },
] as const;

/** Mirrors canonical_framework_versions_key_grammar_check in 20261068. */
export const CANONICAL_FRAMEWORK_KEY_PATTERN = /^[a-z0-9]+([.-][a-z0-9]+)*$/;

const BY_DISPLAY = new Map<string, CanonicalFrameworkIdentity>(
  CANONICAL_FRAMEWORK_VERSIONS.map((f) => [`${f.display_name}\u0000${f.framework_version}`, f])
);

/**
 * Resolve a tenant `frameworks` row's (name, version) to its canonical
 * identity. EXACT match only: a near-match is a WRONG canonical identity, and a
 * wrong identity here would attach one framework's crosswalk to another
 * framework's requirements.
 *
 * `null` is a legitimate answer and means "customer-authored framework with no
 * SecureLogic canonical identity" - a positive state, not a failure.
 */
export function resolveCanonicalFrameworkIdentity(
  displayName: string,
  version: string
): CanonicalFrameworkIdentity | null {
  return BY_DISPLAY.get(`${displayName}\u0000${version}`) ?? null;
}

/** Convenience: just the key, for the `frameworks.framework_key` write. */
export function canonicalFrameworkKeyFor(displayName: string, version: string): string | null {
  return resolveCanonicalFrameworkIdentity(displayName, version)?.framework_key ?? null;
}

/** Is this a (key, version) pair the registry knows about? */
export function isKnownCanonicalFrameworkVersion(
  frameworkKey: string,
  frameworkVersion: string
): boolean {
  return CANONICAL_FRAMEWORK_VERSIONS.some(
    (f) => f.framework_key === frameworkKey && f.framework_version === frameworkVersion
  );
}
