/**
 * findingEntitySearch.ts — reverse entity→findings resolution ("which findings
 * belong to Microsoft?") for the work-first Findings page (ERIP).
 *
 * Read-only. Given an entity-name query, finds the org's matching vendors /
 * AI systems / controls / obligations, then resolves every finding connected to
 * them through the EXISTING canonical paths — no new tables, no stored mapping:
 *
 *   intelligence path   entity → signal_*_links → cyber_signals → findings
 *                       (source_type cyber_signal/signal), plus the
 *                       intelligence_event bridge via intelligence_event_sources
 *   assessment paths    entity → its assessment/review rows → findings
 *                       (vendor_review, vendor_cycle_review, control_test,
 *                        ai_review, ai_governance_review, obligation_review)
 *
 * Every predicate is org-scoped from the caller (never request input). Table and
 * column names are constants — the same interpolation discipline as
 * findingContextResolver. The query string is bound as a parameter (ILIKE).
 */

export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

export type EntityMatchType = "vendor" | "ai_system" | "control" | "obligation";

export interface MatchedEntity {
  type: EntityMatchType;
  id: string;
  name: string;
}

export interface EntityFindingsResult {
  entities: MatchedEntity[];
  finding_ids: string[];
}

/** PURE: normalize a raw search query. Returns null when unusable. */
export function normalizeEntityQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.trim();
  if (q.length < 2 || q.length > 120) return null;
  return q;
}

/** PURE: the bound ILIKE pattern for a normalized query (escapes LIKE wildcards). */
export function entityQueryPattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const ENTITY_SOURCES: Array<{ type: EntityMatchType; table: string; nameCol: string }> = [
  { type: "vendor", table: "vendors", nameCol: "name" },
  { type: "ai_system", table: "ai_systems", nameCol: "name" },
  { type: "control", table: "controls", nameCol: "name" },
  { type: "obligation", table: "obligations", nameCol: "title" },
];

const SIGNAL_LINKS: Record<EntityMatchType, { table: string; fk: string }> = {
  vendor: { table: "signal_vendor_links", fk: "vendor_id" },
  ai_system: { table: "signal_ai_system_links", fk: "ai_system_id" },
  control: { table: "signal_control_links", fk: "control_id" },
  obligation: { table: "signal_obligation_links", fk: "obligation_id" },
};

/** Assessment-family tables per entity type → the finding source_type they emit. */
const ASSESSMENT_SOURCES: Record<EntityMatchType, Array<{ table: string; fk: string; sourceType: string }>> = {
  vendor: [
    { table: "vendor_assessments", fk: "vendor_id", sourceType: "vendor_review" },
    { table: "vendor_reviews", fk: "vendor_id", sourceType: "vendor_cycle_review" },
  ],
  ai_system: [
    { table: "governance_reviews", fk: "ai_system_id", sourceType: "ai_review" },
    { table: "ai_governance_assessments", fk: "ai_system_id", sourceType: "ai_governance_review" },
  ],
  control: [{ table: "control_assessments", fk: "control_id", sourceType: "control_test" }],
  obligation: [{ table: "obligation_assessments", fk: "obligation_id", sourceType: "obligation_review" }],
};

/**
 * Resolve the org's findings connected to any entity whose name matches `query`.
 * Returns the matched entities (for "showing results for …" UI) and the distinct
 * finding ids, most-recent first, capped.
 */
export async function searchFindingsByEntity(
  client: Queryable,
  organizationId: string,
  query: string,
  opts: { maxEntities?: number; maxFindings?: number } = {}
): Promise<EntityFindingsResult> {
  const pattern = entityQueryPattern(query);
  const maxEntities = opts.maxEntities ?? 25;
  const maxFindings = opts.maxFindings ?? 200;

  // 1. Matching entities per type (org-scoped, bounded).
  const entities: MatchedEntity[] = [];
  for (const src of ENTITY_SOURCES) {
    const r = await client.query(
      `SELECT id, ${src.nameCol} AS name FROM ${src.table}
        WHERE organization_id = $1 AND ${src.nameCol} ILIKE $2
        ORDER BY ${src.nameCol} LIMIT $3`,
      [organizationId, pattern, maxEntities]
    );
    for (const x of r.rows) entities.push({ type: src.type, id: x.id, name: x.name });
  }
  if (entities.length === 0) return { entities: [], finding_ids: [] };

  const idsByType = new Map<EntityMatchType, string[]>();
  for (const e of entities) idsByType.set(e.type, [...(idsByType.get(e.type) ?? []), e.id]);

  const findingIds = new Set<string>();

  for (const [type, ids] of idsByType.entries()) {
    // 2a. Intelligence path: entity → signal links → signals → findings (+ event bridge).
    const link = SIGNAL_LINKS[type];
    const sig = await client.query(
      `SELECT DISTINCT signal_id FROM ${link.table}
        WHERE organization_id = $1 AND ${link.fk} = ANY($2::uuid[]) AND deleted_at IS NULL`,
      [organizationId, ids]
    );
    const signalIds: string[] = sig.rows.map((x) => x.signal_id);
    if (signalIds.length > 0) {
      const f1 = await client.query(
        `SELECT id FROM findings
          WHERE organization_id = $1 AND source_type IN ('cyber_signal', 'signal')
            AND source_id = ANY($2::uuid[])`,
        [organizationId, signalIds]
      );
      for (const x of f1.rows) findingIds.add(x.id);

      const ev = await client.query(
        `SELECT DISTINCT event_id FROM intelligence_event_sources WHERE cyber_signal_id = ANY($1::uuid[])`,
        [signalIds]
      );
      const eventIds: string[] = ev.rows.map((x) => x.event_id);
      if (eventIds.length > 0) {
        const f2 = await client.query(
          `SELECT id FROM findings
            WHERE organization_id = $1 AND source_type = 'intelligence_event'
              AND source_id = ANY($2::uuid[])`,
          [organizationId, eventIds]
        );
        for (const x of f2.rows) findingIds.add(x.id);
      }
    }

    // 2b. Assessment paths: entity → assessment rows → findings by source_type.
    for (const a of ASSESSMENT_SOURCES[type]) {
      const f = await client.query(
        `SELECT f.id FROM findings f
           JOIN ${a.table} src ON src.id = f.source_id AND src.organization_id = f.organization_id
          WHERE f.organization_id = $1 AND f.source_type = $2
            AND src.${a.fk} = ANY($3::uuid[])`,
        [organizationId, a.sourceType, ids]
      );
      for (const x of f.rows) findingIds.add(x.id);
    }
  }

  return { entities, finding_ids: Array.from(findingIds).slice(0, maxFindings) };
}
