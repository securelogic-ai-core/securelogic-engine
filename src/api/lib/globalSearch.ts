import { searchLikePattern } from "./findingQuerySearch.js";

/**
 * globalSearch.ts — cross-object search over the canonical domain objects.
 *
 * The platform had per-page search (findings `?q=`, assets `?q=`) but no way
 * to answer "where does 'Acme' appear?" without knowing which page to open
 * first. This federates the canonical objects an enterprise user navigates
 * by name — findings, risks, vendors, AI systems, controls, obligations,
 * assets — into one ranked, org-scoped result set.
 *
 * Design:
 *  - One query per object type, each org-scoped and bounded by PER_TYPE_LIMIT,
 *    run on the caller's tenant-scoped client (asTenant serializes them).
 *  - Reuses the ratified ILIKE escaping (searchLikePattern) — no new matching
 *    vocabulary, no full-text index to keep in sync.
 *  - Assets ride asset_search_index_v (the shared search projection: name,
 *    hostname, cloud account, product aliases). Whether assets appear at all
 *    is the ROUTE's decision (registry flag AND the org's enterprise_context
 *    capability) — the same dual condition every other registry surface
 *    enforces; this module never weakens an entitlement boundary on its own.
 *  - Results carry a stable `href` so the UI never re-derives routing.
 *
 * Ranking is deliberately simple and explainable: exact (case-insensitive)
 * title match first, then prefix match, then everything else, then by
 * recency. No opaque relevance score the user cannot reason about.
 */

export const PER_TYPE_LIMIT = 5;
export const MAX_QUERY_LENGTH = 200;

export type SearchObjectType =
  | "finding"
  | "risk"
  | "vendor"
  | "ai_system"
  | "control"
  | "obligation"
  | "asset";

export interface SearchHit {
  type: SearchObjectType;
  id: string;
  title: string;
  /** Type-appropriate secondary line (severity, domain, status…) or null. */
  subtitle: string | null;
  /** App route for this object — the UI never re-derives routing. */
  href: string;
}

export interface SearchResults {
  query: string;
  total: number;
  hits: SearchHit[];
}

/** Minimal shape of the tenant-scoped client the route hands us. */
export interface SearchQueryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[] }>;
}

/** Trim + length-bound a raw query param. null = no usable query. */
export function normalizeGlobalQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.trim();
  if (q.length < 2 || q.length > MAX_QUERY_LENGTH) return null;
  return q;
}

/**
 * PURE: rank hits for display. Exact title match, then prefix, then the rest;
 * ties keep the per-type query order (recency). Stable and explainable.
 */
export function rankHits(hits: SearchHit[], query: string): SearchHit[] {
  const q = query.toLowerCase();
  const tier = (h: SearchHit): number => {
    const t = h.title.toLowerCase();
    if (t === q) return 0;
    if (t.startsWith(q)) return 1;
    return 2;
  };
  return hits
    .map((hit, index) => ({ hit, index, tier: tier(hit) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((x) => x.hit);
}

interface TypeSpec {
  type: SearchObjectType;
  sql: string;
  hrefPrefix: string;
}

/**
 * Per-type search queries. Each is org-scoped ($1), ILIKE-bound ($2), and
 * LIMIT-bound ($3). `title` and `subtitle` are aliased so the mapper is
 * uniform. Ordering is recency so the tie-break inside a tier is "newest".
 */
const TYPE_SPECS: TypeSpec[] = [
  {
    type: "finding",
    hrefPrefix: "/findings/",
    sql: `SELECT id, title, severity AS subtitle
            FROM findings
           WHERE organization_id = $1
             AND (title ILIKE $2 OR description ILIKE $2)
           ORDER BY created_at DESC
           LIMIT $3`,
  },
  {
    type: "risk",
    hrefPrefix: "/risks/",
    sql: `SELECT id, title, risk_rating AS subtitle
            FROM risks
           WHERE organization_id = $1
             AND (title ILIKE $2 OR description ILIKE $2)
           ORDER BY created_at DESC
           LIMIT $3`,
  },
  {
    type: "vendor",
    hrefPrefix: "/vendors/",
    sql: `SELECT id, name AS title, criticality AS subtitle
            FROM vendors
           WHERE organization_id = $1
             AND name ILIKE $2
           ORDER BY created_at DESC
           LIMIT $3`,
  },
  {
    type: "ai_system",
    hrefPrefix: "/ai-systems/",
    sql: `SELECT id, name AS title, risk_classification AS subtitle
            FROM ai_systems
           WHERE organization_id = $1
             AND name ILIKE $2
           ORDER BY created_at DESC
           LIMIT $3`,
  },
  {
    type: "control",
    hrefPrefix: "/controls/",
    sql: `SELECT id, name AS title, domain AS subtitle
            FROM controls
           WHERE organization_id = $1
             AND name ILIKE $2
           ORDER BY created_at DESC
           LIMIT $3`,
  },
  {
    type: "obligation",
    hrefPrefix: "/obligations/",
    sql: `SELECT id, title, source_regulation AS subtitle
            FROM obligations
           WHERE organization_id = $1
             AND title ILIKE $2
           ORDER BY created_at DESC
           LIMIT $3`,
  },
];

/**
 * Assets ride the shared search projection (name / hostname / cloud account /
 * product alias), so a hostname or account id finds its asset. DISTINCT
 * because one asset can match on several terms.
 */
const ASSET_SPEC: TypeSpec = {
  type: "asset",
  hrefPrefix: "/assets/",
  sql: `SELECT DISTINCT ON (asset_id) asset_id AS id, term AS title, asset_type AS subtitle
          FROM asset_search_index_v
         WHERE organization_id = $1
           AND term ILIKE $2
         ORDER BY asset_id, term
         LIMIT $3`,
};

export interface GlobalSearchOptions {
  /**
   * Whether the asset section runs at all. The route computes this as
   * (registry flag on) AND (org has the enterprise_context capability) so
   * search honors the same gate as every other asset surface.
   */
  includeAssets: boolean;
  onTypeError?: (type: SearchObjectType, err: unknown) => void;
}

/**
 * Run the federated search. Each type failure is isolated: a missing optional
 * table or a type-specific error degrades that section to zero hits rather
 * than failing the whole search (a search box that 500s is worse than one
 * that under-reports, and the caller logs the failure).
 */
export async function runGlobalSearch(
  db: SearchQueryable,
  organizationId: string,
  query: string,
  options: GlobalSearchOptions
): Promise<SearchResults> {
  const { includeAssets, onTypeError } = options;
  const pattern = searchLikePattern(query);
  const specs = includeAssets ? [...TYPE_SPECS, ASSET_SPEC] : TYPE_SPECS;

  const hits: SearchHit[] = [];
  for (const spec of specs) {
    try {
      const result = await db.query<{
        id: string;
        title: string | null;
        subtitle: string | null;
      }>(spec.sql, [organizationId, pattern, PER_TYPE_LIMIT]);

      for (const row of result.rows) {
        if (!row.id || !row.title) continue;
        hits.push({
          type: spec.type,
          id: row.id,
          title: row.title,
          subtitle: row.subtitle ?? null,
          href: `${spec.hrefPrefix}${row.id}`,
        });
      }
    } catch (err) {
      onTypeError?.(spec.type, err);
    }
  }

  return { query, total: hits.length, hits: rankHits(hits, query) };
}
