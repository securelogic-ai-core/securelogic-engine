/**
 * findingQuerySearch.ts — free-text search resolution for the Risk Findings
 * queue (`GET /api/findings?q=`).
 *
 * The queue searches five things: title, description, finding id, CVE, and the
 * name of the vendor / AI system / control / obligation the finding is about.
 * Title/description/id are plain ILIKE on the findings row (handled inline in
 * the route). The two INDIRECT dimensions — CVE and entity name — resolve to a
 * bounded set of finding ids here, which the route ORs into its WHERE:
 *
 *   (f.title ILIKE $p OR f.description ILIKE $p OR f.id::text ILIKE $p
 *      OR f.id = ANY($ids::uuid[]))
 *
 * Every query is org-scoped from the caller (never request input); the query
 * string is bound as a parameter. Entity-name resolution reuses the tested
 * searchFindingsByEntity (vendors / ai_systems / controls / obligations — the
 * monitored "assets" a finding is about). CVE resolution joins the finding to
 * its source cyber-signal or intelligence-event.
 */

import {
  searchFindingsByEntity,
  normalizeEntityQuery,
  type Queryable,
} from "./findingEntitySearch.js";

/** Max finding ids the indirect resolver returns (bounds the OR-in clause). */
const MAX_SEARCH_IDS = 500;

/** PURE: normalize a raw `q`. Returns null when unusable (empty / too long). */
export function normalizeSearchQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.trim();
  if (q.length < 1 || q.length > 200) return null;
  return q;
}

/** PURE: the bound ILIKE pattern for a query (escapes LIKE wildcards). */
export function searchLikePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Resolve the org's findings that match `q` on an INDIRECT dimension — CVE or
 * the name of a linked vendor / AI system / control / obligation. Returns a
 * bounded, de-duplicated set of finding ids. Empty when nothing matches (the
 * route then falls back to its direct title/description/id ILIKE alone).
 *
 * Runs sequential queries on the caller's (tenant-scoped) client — safe under
 * asTenant, which serializes queries on the single tenant connection.
 */
export async function resolveSearchFindingIds(
  client: Queryable,
  organizationId: string,
  q: string
): Promise<string[]> {
  const ids = new Set<string>();
  const pattern = searchLikePattern(q);

  // 1. CVE — findings whose source cyber-signal carries a matching CVE.
  const sigCve = await client.query(
    `SELECT f.id FROM findings f
       JOIN cyber_signals cs ON cs.id = f.source_id
      WHERE f.organization_id = $1
        AND f.source_type IN ('cyber_signal', 'signal')
        AND cs.affected_cve ILIKE $2
      LIMIT $3`,
    [organizationId, pattern, MAX_SEARCH_IDS]
  );
  for (const r of sigCve.rows) ids.add(r.id);

  // 2. CVE — findings whose source intelligence-event carries a matching CVE.
  const eventCve = await client.query(
    `SELECT f.id FROM findings f
       JOIN intelligence_events e ON e.id = f.source_id
      WHERE f.organization_id = $1
        AND f.source_type = 'intelligence_event'
        AND e.affected_cve ILIKE $2
      LIMIT $3`,
    [organizationId, pattern, MAX_SEARCH_IDS]
  );
  for (const r of eventCve.rows) ids.add(r.id);

  // 3. Entity name — vendor / AI system / control / obligation the finding is
  //    about (the monitored "assets"). Reuses the tested resolver; it requires a
  //    2+ char query, so a 1-char search stays a pure title/description/id scan.
  if (normalizeEntityQuery(q)) {
    const entity = await searchFindingsByEntity(client, organizationId, q, {
      maxFindings: MAX_SEARCH_IDS,
    });
    for (const id of entity.finding_ids) ids.add(id);
  }

  return Array.from(ids).slice(0, MAX_SEARCH_IDS);
}
