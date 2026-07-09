/**
 * findingContextResolver.ts — ERIP Package 3 (Decision Workspace), Phase 3.0.
 *
 * Read-only composition layer that gathers, for a single finding, everything the
 * Decision Workspace needs so the customer never has to page-hop: affected
 * entities (vendors / AI systems / controls / obligations), the supporting
 * canonical Intelligence Events (+ their sources and timeline), evidence, related
 * findings, the owner, the activity log, and "what's changed" since a marker.
 *
 * NO schema change. Composes existing canonical tables. Every customer-data query
 * is scoped by organization_id, sourced from the caller (never request input).
 * Intelligence Events are GLOBAL (no organization_id) and are reached only via the
 * finding's own org-scoped source references or org-scoped signal links.
 *
 * The `client` is any pg-queryable — the route passes the tenant-aware `pg`; the
 * isolation test passes a raw Pool. Isolation holds because every predicate here
 * carries `organization_id = $org` regardless of the client.
 */

export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

export type AffectedEntityType = "vendor" | "ai_system" | "control" | "obligation";

export interface FindingAffectedEntity {
  type: AffectedEntityType;
  id: string;
  name: string;
}

export interface FindingContext {
  finding: { id: string; source_type: string; source_id: string | null };
  owner: { id: string; email: string } | null;
  affected: {
    vendors: FindingAffectedEntity[];
    ai_systems: FindingAffectedEntity[];
    controls: FindingAffectedEntity[];
    obligations: FindingAffectedEntity[];
  };
  intelligence: {
    events: Array<Record<string, unknown>>;
    sources: Array<Record<string, unknown>>;
    timeline: Array<Record<string, unknown>>;
  };
  evidence: Array<Record<string, unknown>>;
  related_findings: Array<Record<string, unknown>>;
  activity: Array<Record<string, unknown>>;
  whats_changed: { since: string | null; changes: Array<{ label: string; at: string }> };
}

export interface IntelRefs {
  signalIds: string[];
  eventIds: string[];
}

/**
 * PURE: the direct intelligence references a finding's source points at, before
 * any DB expansion. `cyber_signal`/`signal` → a cyber_signals id; `intelligence_event`
 * → an intelligence_events id; everything else (assessment-sourced findings) → none
 * (their affected-entity resolution is a later phase, documented in the design).
 */
export function directIntelRefs(sourceType: string, sourceId: string | null): IntelRefs {
  if (!sourceId) return { signalIds: [], eventIds: [] };
  if (sourceType === "intelligence_event") return { signalIds: [], eventIds: [sourceId] };
  if (sourceType === "cyber_signal" || sourceType === "signal") return { signalIds: [sourceId], eventIds: [] };
  return { signalIds: [], eventIds: [] };
}

/**
 * PURE: turn a finding activity row into a human "what's changed" label. Kept
 * separate so it is unit-testable without a database.
 */
export function describeChange(eventType: string, payload: unknown): string {
  const p = (payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;
  switch (eventType) {
    case "finding.created":
      return "Finding created";
    case "finding.updated": {
      if (p["severity"]) return `Severity changed to ${String(p["severity"])}`;
      if (p["status"]) return `Status changed to ${String(p["status"])}`;
      if (p["owner_user_id"]) return "Owner reassigned";
      if (p["priority"]) return `Priority changed to ${String(p["priority"])}`;
      if (p["due_date"]) return "SLA / due date changed";
      return "Finding updated";
    }
    default:
      return eventType.replace(/^finding\./, "").replace(/[._]/g, " ");
  }
}

function uniq(ids: (string | null | undefined)[]): string[] {
  return Array.from(new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0)));
}

/**
 * Resolve the full Decision Workspace context for a finding. Returns null when the
 * finding does not exist in the caller's org (the route maps that to 404).
 */
export async function resolveFindingContext(
  client: Queryable,
  organizationId: string,
  findingId: string,
  opts: { since?: string | null } = {}
): Promise<FindingContext | null> {
  const f = await client.query(
    `SELECT id, source_type, source_id, owner_user_id
       FROM findings
      WHERE id = $1 AND organization_id = $2`,
    [findingId, organizationId]
  );
  if ((f.rowCount ?? 0) === 0) return null;
  const finding = f.rows[0];

  // Expand intelligence references across the signal↔event bridge.
  const refs = directIntelRefs(finding.source_type, finding.source_id);
  let signalIds = refs.signalIds;
  let eventIds = refs.eventIds;
  if (signalIds.length > 0) {
    const r = await client.query(
      `SELECT DISTINCT event_id FROM intelligence_event_sources WHERE cyber_signal_id = ANY($1::uuid[])`,
      [signalIds]
    );
    eventIds = uniq([...eventIds, ...r.rows.map((x) => x.event_id)]);
  }
  if (refs.eventIds.length > 0) {
    const r = await client.query(
      `SELECT DISTINCT cyber_signal_id FROM intelligence_event_sources
         WHERE event_id = ANY($1::uuid[]) AND cyber_signal_id IS NOT NULL`,
      [refs.eventIds]
    );
    signalIds = uniq([...signalIds, ...r.rows.map((x) => x.cyber_signal_id)]);
  }

  // Affected entities via org-scoped signal_*_links (soft-delete aware).
  async function affected(
    table: string,
    fk: string,
    entityTable: string,
    nameCol: string,
    type: AffectedEntityType
  ): Promise<FindingAffectedEntity[]> {
    if (signalIds.length === 0) return [];
    const r = await client.query(
      `SELECT e.id AS id, e.${nameCol} AS name
         FROM ${table} l
         JOIN ${entityTable} e ON e.id = l.${fk} AND e.organization_id = l.organization_id
        WHERE l.organization_id = $1
          AND l.signal_id = ANY($2::uuid[])
          AND l.deleted_at IS NULL
        ORDER BY e.${nameCol}`,
      [organizationId, signalIds]
    );
    return r.rows.map((x) => ({ type, id: x.id, name: x.name }));
  }

  const [vendors, ai_systems, controls, obligations] = await Promise.all([
    affected("signal_vendor_links", "vendor_id", "vendors", "name", "vendor"),
    affected("signal_ai_system_links", "ai_system_id", "ai_systems", "name", "ai_system"),
    affected("signal_control_links", "control_id", "controls", "name", "control"),
    affected("signal_obligation_links", "obligation_id", "obligations", "title", "obligation"),
  ]);

  // Supporting Intelligence Events (GLOBAL) + their sources + timeline.
  const events = eventIds.length
    ? (
        await client.query(
          `SELECT id, canonical_key, title, event_type, severity, status,
                  ever_exploited, ever_patched, affected_cve, affected_vendor,
                  source_count, confidence, first_seen_at, last_seen_at
             FROM intelligence_events
            WHERE id = ANY($1::uuid[])`,
          [eventIds]
        )
      ).rows
    : [];
  const sources = eventIds.length
    ? (
        await client.query(
          `SELECT event_id, source, external_id, relation, confidence, last_contributed_at
             FROM intelligence_event_sources
            WHERE event_id = ANY($1::uuid[])
            ORDER BY last_contributed_at DESC`,
          [eventIds]
        )
      ).rows
    : [];
  const timeline = eventIds.length
    ? (
        await client.query(
          `SELECT event_id, entry_type, occurred_at, summary, source
             FROM intelligence_event_timeline
            WHERE event_id = ANY($1::uuid[])
            ORDER BY occurred_at DESC
            LIMIT 50`,
          [eventIds]
        )
      ).rows
    : [];

  // Evidence attached directly to the finding (evidence.source_type='finding').
  const evidence = (
    await client.query(
      `SELECT id, title, description, evidence_type, collected_at, collected_by, external_ref, created_at
         FROM evidence
        WHERE organization_id = $1 AND source_type = 'finding' AND source_id = $2
        ORDER BY created_at DESC`,
      [organizationId, findingId]
    )
  ).rows;

  // Related findings — same source object, same org (v1 heuristic).
  const related_findings = finding.source_id
    ? (
        await client.query(
          `SELECT id, title, severity, status
             FROM findings
            WHERE organization_id = $1 AND id <> $2
              AND source_id = $3 AND source_type = $4
            ORDER BY created_at DESC
            LIMIT 10`,
          [organizationId, findingId, finding.source_id, finding.source_type]
        )
      ).rows
    : [];

  // Owner (org-scoped defensive lookup).
  const owner = finding.owner_user_id
    ? (
        await client.query(`SELECT id, email FROM users WHERE id = $1 AND organization_id = $2`, [
          finding.owner_user_id,
          organizationId,
        ])
      ).rows[0] ?? null
    : null;

  // Activity from the org-scoped security audit log for this finding.
  const activityRows = (
    await client.query(
      `SELECT event_type, resource_type, resource_id, payload, created_at
         FROM security_audit_log
        WHERE organization_id = $1 AND resource_type = 'finding' AND resource_id = $2
        ORDER BY created_at DESC
        LIMIT 50`,
      [organizationId, findingId]
    )
  ).rows;

  // What's changed since the marker (opts.since). When no marker, empty (the UI
  // shows "No changes" / first review). Per-user markers land in a later phase.
  const since = opts.since ?? null;
  const changes = since
    ? activityRows
        .filter((a) => new Date(a.created_at).getTime() > new Date(since).getTime())
        .map((a) => ({ label: describeChange(a.event_type, a.payload), at: String(a.created_at) }))
    : [];

  return {
    finding: { id: finding.id, source_type: finding.source_type, source_id: finding.source_id },
    owner,
    affected: { vendors, ai_systems, controls, obligations },
    intelligence: { events, sources, timeline },
    evidence,
    related_findings,
    activity: activityRows,
    whats_changed: { since, changes },
  };
}
