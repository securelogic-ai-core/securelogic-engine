/**
 * assetSearchResolver.ts — the shared "search term → canonical asset IDs"
 * resolver for every search-capable, asset-related surface.
 *
 * One implementation of asset search semantics, so pages compose IDs into
 * their existing queries (`asset_id = ANY($ids)`) instead of each hand-rolling
 * subtype ILIKE joins. Reads asset_search_index_v (20260908) — one row per
 * (asset, searchable term): name, hostname, cloud_account, external_ref.
 *
 * Matching semantics (the platform definition):
 *   * UUID terms   — EXACT match on the canonical asset_id or backing_id
 *                    (a pasted ID either identifies an asset or it doesn't).
 *   * text terms   — case-insensitive CONTAINS (ILIKE, wildcards escaped),
 *                    2–120 chars, the same bounds/escaping as
 *                    findingEntitySearch and the /queue suggestion search.
 *   * dedup        — one row per asset (DISTINCT ON), best term_kind wins
 *                    (name > hostname > cloud_account > alias > external_ref).
 *   * bounded      — capped (default 200, findingEntitySearch precedent);
 *                    `truncated` tells callers the cap was hit so they can
 *                    say "narrow your search" instead of silently lying.
 *
 * Matches carry BOTH identities: the canonical asset_id (registry surfaces)
 * and backing_kind/backing_id (federated per-type surfaces — vendors,
 * ai-systems, enterprise-context lists key on their own table's id, EAR-AD-1).
 *
 * Every query is org-scoped from the caller (never request input) — vendors /
 * ai_systems carry no RLS, so the explicit predicate is the primary tenant
 * control here, same as every registry read. Read-only; never logs the term.
 */

export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

export const ASSET_SEARCH_MIN_LENGTH = 2;
export const ASSET_SEARCH_MAX_LENGTH = 120;
export const ASSET_SEARCH_MAX_MATCHES = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PURE: normalize a raw search term. Returns null when unusable (caller 400s). */
export function normalizeAssetSearchTerm(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const term = raw.trim();
  if (term.length < ASSET_SEARCH_MIN_LENGTH || term.length > ASSET_SEARCH_MAX_LENGTH) return null;
  return term;
}

/** PURE: the bound ILIKE pattern for a normalized term (escapes LIKE wildcards). */
export function assetSearchPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export type AssetSearchMatchKind =
  | "id"
  | "name"
  | "hostname"
  | "cloud_account"
  | "alias"
  | "external_ref";

export interface AssetSearchMatch {
  asset_id: string;
  asset_type: string;
  backing_kind: string;
  backing_id: string;
  matched_kind: AssetSearchMatchKind;
}

export interface AssetSearchResult {
  matches: AssetSearchMatch[];
  /** True when the cap was hit — the match set is a prefix, not the population. */
  truncated: boolean;
}

/** PURE: the backing-table ids among matches for one backing kind (federated lists). */
export function backingIdsOf(matches: AssetSearchMatch[], backingKind: string): string[] {
  return matches.filter((m) => m.backing_kind === backingKind).map((m) => m.backing_id);
}

/**
 * Resolve a normalized term to the org's matching canonical asset IDs.
 * Deterministic: ranked by term_kind then asset_id, deduped per asset.
 * `assetTypes` narrows BEFORE the cap so a type-filtered page never loses
 * matches of its own type to higher-ranked matches of another.
 */
export async function resolveAssetSearch(
  client: Queryable,
  organizationId: string,
  term: string,
  opts: { assetTypes?: string[]; maxMatches?: number } = {}
): Promise<AssetSearchResult> {
  const cap = opts.maxMatches ?? ASSET_SEARCH_MAX_MATCHES;
  const types = opts.assetTypes && opts.assetTypes.length > 0 ? opts.assetTypes : null;

  if (UUID_RE.test(term)) {
    const r = await client.query(
      `SELECT asset_id, asset_type, backing_kind, backing_id FROM asset_registry_v
        WHERE organization_id = $1
          AND (asset_id = $2::uuid OR backing_id = $2::uuid)
          AND ($3::text[] IS NULL OR asset_type = ANY($3::text[]))
        ORDER BY asset_id
        LIMIT $4`,
      [organizationId, term, types, cap + 1]
    );
    const rows = r.rows.slice(0, cap);
    return {
      matches: rows.map((x) => ({
        asset_id: x.asset_id,
        asset_type: x.asset_type,
        backing_kind: x.backing_kind,
        backing_id: x.backing_id,
        matched_kind: "id" as const
      })),
      truncated: r.rows.length > cap
    };
  }

  const pattern = assetSearchPattern(term);
  const r = await client.query(
    `SELECT asset_id, asset_type, backing_kind, backing_id, term_kind
       FROM (
         SELECT DISTINCT ON (asset_id) asset_id, asset_type, backing_kind, backing_id, term_kind,
                CASE term_kind
                  WHEN 'name' THEN 0
                  WHEN 'hostname' THEN 1
                  WHEN 'cloud_account' THEN 2
                  WHEN 'alias' THEN 3
                  ELSE 4
                END AS kind_rank
           FROM asset_search_index_v
          WHERE organization_id = $1
            AND term ILIKE $2
            AND ($3::text[] IS NULL OR asset_type = ANY($3::text[]))
          ORDER BY asset_id, kind_rank
       ) m
      ORDER BY m.kind_rank, m.asset_id
      LIMIT $4`,
    [organizationId, pattern, types, cap + 1]
  );
  const rows = r.rows.slice(0, cap);
  return {
    matches: rows.map((x) => ({
      asset_id: x.asset_id,
      asset_type: x.asset_type,
      backing_kind: x.backing_kind,
      backing_id: x.backing_id,
      matched_kind: x.term_kind as AssetSearchMatchKind
    })),
    truncated: r.rows.length > cap
  };
}
