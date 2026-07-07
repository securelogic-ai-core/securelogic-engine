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

export interface IntelligenceEventDetail {
  readonly event: IntelligenceEventRow;
  readonly sources: EventSourceRow[];
  readonly timeline: EventTimelineRow[];
}

/** Fetch one event with its corroboration ledger + chronological timeline. */
export async function getIntelligenceEventDetail(eventId: string): Promise<IntelligenceEventDetail | null> {
  const evt = await pgElevated.query<IntelligenceEventRow>(
    `SELECT id, canonical_key, title, executive_summary, summary_status, event_type,
            severity, status, affected_cve, affected_vendor, source_count, confidence,
            first_seen_at, last_seen_at, revision
       FROM intelligence_events WHERE id = $1`,
    [eventId]
  );
  if (evt.rows.length === 0) return null;

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

  return { event: evt.rows[0]!, sources: sources.rows, timeline: timeline.rows };
}
