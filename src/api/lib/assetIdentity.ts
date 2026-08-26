/**
 * assetIdentity.ts — resolving a source's asset identifiers to a SecureLogic asset.
 *
 * PURE. No I/O, no database, no clock. The caller fetches candidate matches and
 * passes them in, so every rule below is unit-testable and explainable to a
 * customer asking "why did you attach this vulnerability to that host?".
 *
 * ── THE PROBLEM ────────────────────────────────────────────────────────────
 * A scan report identifies a host by whatever it happened to know: a hostname, an
 * FQDN, an IP, a cloud resource id, its own internal asset id, or several at
 * once. None of those is reliably an identity:
 *
 *   * an IP ADDRESS IS A LEASE, not a name. Today's 10.0.4.12 is tomorrow's other
 *     host, so resolving on it would silently move a vulnerability between assets
 *     — the failure mode is invisible and the record is wrong afterwards.
 *   * a HOSTNAME IS NOT UNIQUE. Two `web01`s in two domains is ordinary, and a
 *     model that assumes otherwise merges two hosts' exposure into one.
 *   * a SCANNER'S ASSET ID is stable only WITHIN that scanner. Two products both
 *     numbering their assets from 1 is not a coincidence, it is the default.
 *
 * ── THE TWO RULES ──────────────────────────────────────────────────────────
 * 1. VOLATILE SCHEMES NEVER RESOLVE. `ip` and `mac` are stored as evidence (a
 *    report contains them and dropping them loses provenance) but are never a
 *    resolution key, alone or in combination.
 *
 * 2. AMBIGUITY REFUSES, IT DOES NOT GUESS. When the strongest scheme available
 *    matches more than one asset, the answer is `ambiguous` and a human decides.
 *    Picking the first, newest or "best" match would produce a confident wrong
 *    attachment — and an occurrence on the wrong host is worse than no occurrence
 *    at all, because it reports exposure someone will act on.
 *
 * This mirrors severityNormalization.ts, deliberately: three outcomes rather than
 * two, failing toward the one that asks a question instead of answering it wrongly.
 */

/** Every scheme asset_identifiers accepts — mirrors the DB CHECK (20261033). */
export const ASSET_IDENTIFIER_SCHEMES = [
  "internal_id",
  "hostname",
  "fqdn",
  "ip",
  "mac",
  "cloud_resource_id",
  "instance_id",
  "application_id",
  "scanner_asset_id",
] as const;

export type AssetIdentifierScheme = (typeof ASSET_IDENTIFIER_SCHEMES)[number];

/**
 * Stored, never resolved on. See rule 1 — these describe where a host was
 * reachable at a moment, not which host it is.
 */
export const VOLATILE_SCHEMES: ReadonlySet<string> = new Set(["ip", "mac"]);

/**
 * Resolution precedence, strongest identity first. The order is by how hard the
 * scheme is to collide, not by how often it appears in reports:
 *
 *   cloud_resource_id  an ARN / resource id is globally unique by construction
 *   instance_id        unique within a provider account, effectively unique here
 *   internal_id        the customer's own CMDB id — one authority, one namespace
 *   scanner_asset_id   stable within its source, so matched SOURCE-SCOPED only
 *   fqdn               unique within a domain; collides only across split-horizon DNS
 *   application_id     unique per application registry
 *   hostname           LAST, because it is the one everybody has and nobody can trust
 */
export const RESOLUTION_PRECEDENCE: readonly AssetIdentifierScheme[] = [
  "cloud_resource_id",
  "instance_id",
  "internal_id",
  "scanner_asset_id",
  "fqdn",
  "application_id",
  "hostname",
];

/**
 * Schemes whose value is only meaningful alongside the source that issued it.
 * Matching these across sources would collide two scanners' independent
 * numbering schemes.
 */
export const SOURCE_SCOPED_SCHEMES: ReadonlySet<string> = new Set(["scanner_asset_id"]);

/** One identifier a source claims for the asset it is describing. */
export interface IdentifierClaim {
  scheme: string;
  value: string;
  /** Required for source-scoped schemes; ignored otherwise. */
  source?: string | null;
}

/** One stored asset_identifiers row that matched a claim. */
export interface IdentifierMatch {
  assetId: string;
  scheme: string;
  value: string;
  source: string;
}

export type AssetResolution =
  | { outcome: "resolved"; assetId: string; via: AssetIdentifierScheme; reason: string }
  | { outcome: "not_found"; reason: string }
  | { outcome: "ambiguous"; via: AssetIdentifierScheme; assetIds: string[]; reason: string };

/** Case- and whitespace-insensitive. Hostnames and FQDNs are not case-sensitive. */
export function normalizeIdentifierValue(scheme: string, raw: string): string {
  const trimmed = raw.trim();
  return scheme === "hostname" || scheme === "fqdn" || scheme === "mac"
    ? trimmed.toLowerCase()
    : trimmed;
}

/** The claims that are usable for resolution at all, in precedence order. */
export function resolvableClaims(claims: readonly IdentifierClaim[]): IdentifierClaim[] {
  const usable = claims.filter(
    (c) =>
      typeof c.value === "string" &&
      c.value.trim().length > 0 &&
      !VOLATILE_SCHEMES.has(c.scheme) &&
      (RESOLUTION_PRECEDENCE as readonly string[]).includes(c.scheme),
  );
  return usable.sort(
    (a, b) =>
      RESOLUTION_PRECEDENCE.indexOf(a.scheme as AssetIdentifierScheme) -
      RESOLUTION_PRECEDENCE.indexOf(b.scheme as AssetIdentifierScheme),
  );
}

/**
 * Decide which asset a set of claims refers to, given the rows that matched them.
 *
 * Walks the precedence order and stops at the FIRST scheme that matched anything:
 * a weaker scheme never overrules a stronger one, and a stronger scheme that is
 * ambiguous is not silently abandoned in favour of a hostname guess. That is the
 * whole point — falling through on ambiguity would reintroduce the guess by the
 * back door.
 */
export function resolveAsset(
  claims: readonly IdentifierClaim[],
  matches: readonly IdentifierMatch[],
): AssetResolution {
  const usable = resolvableClaims(claims);
  if (usable.length === 0) {
    return {
      outcome: "not_found",
      reason:
        "No resolvable identifier supplied — an IP or MAC address alone cannot identify an asset",
    };
  }

  for (const scheme of RESOLUTION_PRECEDENCE) {
    const claimsForScheme = usable.filter((c) => c.scheme === scheme);
    if (claimsForScheme.length === 0) continue;

    const hits = matches.filter((m) => {
      if (m.scheme !== scheme) return false;
      return claimsForScheme.some((c) => {
        if (normalizeIdentifierValue(scheme, c.value) !== normalizeIdentifierValue(scheme, m.value)) {
          return false;
        }
        // A scanner's own asset id means nothing outside the scanner that issued it.
        if (SOURCE_SCOPED_SCHEMES.has(scheme)) {
          return typeof c.source === "string" && c.source.length > 0 && c.source === m.source;
        }
        return true;
      });
    });

    if (hits.length === 0) continue;

    const distinct = [...new Set(hits.map((h) => h.assetId))];
    if (distinct.length === 1) {
      return {
        outcome: "resolved",
        assetId: distinct[0]!,
        via: scheme,
        reason: `Matched on ${scheme}`,
      };
    }
    return {
      outcome: "ambiguous",
      via: scheme,
      assetIds: distinct,
      reason:
        `${distinct.length} assets share this ${scheme} — SecureLogic will not guess which ` +
        `is affected; attach the occurrence explicitly or add a stronger identifier`,
    };
  }

  return {
    outcome: "not_found",
    reason: "No asset in this organization carries any of the supplied identifiers",
  };
}
