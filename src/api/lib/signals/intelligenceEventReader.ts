/**
 * intelligenceEventReader.ts — read surface for canonical Intelligence Events.
 * Intelligence Pipeline Hardening / IE.P7 (goal item 8 — downstream consumes
 * canonical events, not raw signals).
 *
 * GLOBAL reads (events are org-agnostic): uses the elevated channel. Returns the
 * normalized event, its corroboration ledger, and its timeline — the shape every
 * downstream surface (API, UI, brief, exec) should consume instead of raw
 * cyber_signals. Read-only; no mutation.
 */

import { pgElevated } from "../../infra/postgres.js";
import { recommendedActions, type RecommendedAction } from "./eventRecommendedActions.js";
import type { LifecycleState } from "./intelligenceEventLifecycle.js";

export interface IntelligenceEventRow {
  id: string;
  canonical_key: string;
  title: string;
  executive_summary: string;
  summary_status: string;
  event_type: string;
  severity: string;
  status: string;
  affected_cve: string | null;
  affected_vendor: string | null;
  source_count: number;
  confidence: number;
  first_seen_at: string;
  last_seen_at: string;
  revision: number;
}

export interface EventSourceRow {
  source: string;
  external_id: string | null;
  relation: string;
  first_contributed_at: string;
  last_contributed_at: string;
}

export interface EventTimelineRow {
  entry_type: string;
  occurred_at: string;
  summary: string;
  source: string | null;
}

export interface EventListOptions {
  /** Max rows (bounded 1..200, default 50). */
  readonly limit?: number;
  /** Optional severity filter. */
  readonly severity?: string;
  /** Optional status filter. */
  readonly status?: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function boundedLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(raw)));
}

/** List recent canonical events, newest-first, with optional severity/status filters. */
export async function listIntelligenceEvents(opts: EventListOptions = {}): Promise<IntelligenceEventRow[]> {
  const limit = boundedLimit(opts.limit);
  const conds: string[] = [];
  const params: unknown[] = [];
  if (opts.severity) {
    params.push(opts.severity);
    conds.push(`severity = $${params.length}`);
  }
  if (opts.status) {
    params.push(opts.status);
    conds.push(`status = $${params.length}`);
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
  params.push(limit);

  const res = await pgElevated.query<IntelligenceEventRow>(
    `SELECT id, canonical_key, title, executive_summary, summary_status, event_type,
            severity, status, affected_cve, affected_vendor, source_count, confidence,
            first_seen_at, last_seen_at, revision
       FROM intelligence_events
       ${where}
      ORDER BY last_seen_at DESC, id DESC
      LIMIT $${params.length}`,
    params
  );
  return res.rows;
}

export interface RelatedFindingRow {
  id: string;
  title: string;
  severity: string;
  status: string;
  domain: string | null;
}

export interface AffectedAssetRow {
  kind: "vendor";
  id: string;
  name: string;
}

export interface IntelligenceEventDetail {
  readonly event: IntelligenceEventRow;
  /** Corroborating sources with citations (attribution + timestamps). */
  readonly sources: EventSourceRow[];
  /** Chronological lifecycle timeline. */
  readonly timeline: EventTimelineRow[];
  /** The viewing org's findings for this event (empty if no org / none). */
  readonly related_findings: RelatedFindingRow[];
  /** The viewing org's assets/vendors this event affects. */
  readonly affected_assets: AffectedAssetRow[];
  /** Deterministic recommended actions for this event + org context. */
  readonly recommended_actions: RecommendedAction[];
}

/**
 * Fetch one event with its corroboration ledger, timeline, and — when an
 * authenticated org is supplied — that org's related findings, affected assets,
 * and recommended actions. Global reads on the elevated channel; org-scoped
 * reads filter by the explicit orgId (never cross-org).
 */
export async function getIntelligenceEventDetail(
  eventId: string,
  orgId?: string
): Promise<IntelligenceEventDetail | null> {
  const evt = await pgElevated.query<IntelligenceEventRow>(
    `SELECT id, canonical_key, title, executive_summary, summary_status, event_type,
            severity, status, affected_cve, affected_vendor, source_count, confidence,
            first_seen_at, last_seen_at, revision
       FROM intelligence_events WHERE id = $1`,
    [eventId]
  );
  if (evt.rows.length === 0) return null;
  const event = evt.rows[0]!;

  const [sources, timeline] = await Promise.all([
    pgElevated.query<EventSourceRow>(
      `SELECT source, external_id, relation, first_contributed_at, last_contributed_at
         FROM intelligence_event_sources WHERE event_id = $1
        ORDER BY first_contributed_at ASC`,
      [eventId]
    ),
    pgElevated.query<EventTimelineRow>(
      `SELECT entry_type, occurred_at, summary, source
         FROM intelligence_event_timeline WHERE event_id = $1
        ORDER BY occurred_at DESC, id DESC`,
      [eventId]
    )
  ]);

  // Org-scoped enrichment (explicit orgId filter — never cross-org).
  let related_findings: RelatedFindingRow[] = [];
  let affected_assets: AffectedAssetRow[] = [];
  if (orgId) {
    const [findings, assets] = await Promise.all([
      pgElevated.query<RelatedFindingRow>(
        `SELECT id, title, severity, status, domain
           FROM findings
          WHERE organization_id = $1 AND source_type = 'intelligence_event' AND source_id = $2
          ORDER BY created_at DESC`,
        [orgId, eventId]
      ),
      event.affected_vendor
        ? pgElevated.query<{ id: string; name: string }>(
            `SELECT id, name FROM vendors
              WHERE organization_id = $1 AND lower(trim(name)) = lower(trim($2))`,
            [orgId, event.affected_vendor]
          )
        : Promise.resolve({ rows: [] as { id: string; name: string }[] })
    ]);
    related_findings = findings.rows;
    affected_assets = assets.rows.map((v) => ({ kind: "vendor" as const, id: v.id, name: v.name }));
  }

  const actions = recommendedActions({
    status: event.status as LifecycleState,
    severity: event.severity,
    affected_vendor: event.affected_vendor,
    affected_cve: event.affected_cve,
    hasFinding: related_findings.length > 0
  });

  return {
    event,
    sources: sources.rows,
    timeline: timeline.rows,
    related_findings,
    affected_assets,
    recommended_actions: actions
  };
}

// ---------------------------------------------------------------------------
// Executive intelligence summary (item 2) — aggregate over canonical events.
// ---------------------------------------------------------------------------

export interface ExecutiveEventSummary {
  readonly total: number;
  readonly by_status: Record<string, number>;
  readonly by_severity: Record<string, number>;
  readonly actively_exploited: number;
  readonly avg_confidence: number;
  /** Top events by severity then recency, for the executive headline. */
  readonly top_events: IntelligenceEventRow[];
}

/**
 * Aggregate canonical events into an executive intelligence summary (counts by
 * lifecycle state + severity, active-exploitation count, average confidence, top
 * events). GLOBAL read. Excludes archived events. `windowDays` bounds recency.
 */
export async function getExecutiveEventSummary(windowDays = 30): Promise<ExecutiveEventSummary> {
  const days = Math.min(365, Math.max(1, Math.floor(windowDays)));
  const rows = (
    await pgElevated.query<IntelligenceEventRow>(
      `SELECT id, canonical_key, title, executive_summary, summary_status, event_type,
              severity, status, affected_cve, affected_vendor, source_count, confidence,
              first_seen_at, last_seen_at, revision
         FROM intelligence_events
        WHERE status <> 'archived'
          AND last_seen_at >= NOW() - ($1 || ' days')::interval
        ORDER BY last_seen_at DESC`,
      [String(days)]
    )
  ).rows;

  const by_status: Record<string, number> = {};
  const by_severity: Record<string, number> = {};
  let confidenceSum = 0;
  let activelyExploited = 0;
  for (const r of rows) {
    by_status[r.status] = (by_status[r.status] ?? 0) + 1;
    by_severity[r.severity] = (by_severity[r.severity] ?? 0) + 1;
    confidenceSum += Number(r.confidence) || 0;
    if (r.status === "actively_exploited") activelyExploited++;
  }

  const sevRank: Record<string, number> = { Critical: 0, High: 1, Moderate: 2, Low: 3 };
  const top = [...rows]
    .sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9))
    .slice(0, 10);

  return {
    total: rows.length,
    by_status,
    by_severity,
    actively_exploited: activelyExploited,
    avg_confidence: rows.length > 0 ? Math.round(confidenceSum / rows.length) : 0,
    top_events: top
  };
}
