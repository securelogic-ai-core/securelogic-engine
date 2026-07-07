/**
 * eventBriefSource.ts — feed the Intelligence Brief from canonical Intelligence
 * Events instead of raw cyber_signals. Intelligence Pipeline Hardening (item 1).
 *
 * Produces rows in the exact CyberSignalForBrief shape the pure brief generator
 * already consumes, so the brief pipeline (ranking, capping, synthesis, persist)
 * is UNCHANGED — only its input source swaps. Each row's `normalized_summary` is
 * the event's NORMALIZED, display-safe, citation-preserving executive summary
 * (never raw feed text; never a broken sentence), and `cluster_key` is the
 * event's canonical_key so downstream grouping/provenance stays coherent.
 *
 * Events are GLOBAL, so this reads them directly (no per-org filter) — matching
 * the legacy brief's "(organization_id = $1 OR organization_id IS NULL)" which
 * already surfaced global signals. Archived events are excluded (not newsworthy).
 *
 * Flag-gated by the caller: only used when SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED.
 */

import type { CyberSignalForBrief } from "../intelligenceBriefGenerator.js";

interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

interface EventBriefRow {
  id: string;
  event_type: string;
  severity: string;
  title: string;
  executive_summary: string;
  affected_cve: string | null;
  affected_vendor: string | null;
  canonical_key: string;
  last_seen_at: Date | string;
  canonical_source: string;
}

/**
 * Fetch canonical events active in [periodStart, periodEnd) as brief source rows.
 * Newest-first by last activity; archived events excluded. Runs on the caller's
 * (tenant) transaction client — safe because intelligence_events is global/RLS-free.
 */
export async function fetchBriefEventRows(
  client: Queryable,
  periodStart: string,
  periodEnd: string
): Promise<CyberSignalForBrief[]> {
  const res = await client.query<EventBriefRow>(
    `SELECT e.id, e.event_type, e.severity, e.title, e.executive_summary,
            e.affected_cve, e.affected_vendor, e.canonical_key, e.last_seen_at,
            COALESCE(
              (SELECT s.source FROM intelligence_event_sources s
                WHERE s.event_id = e.id AND s.relation = 'canonical' LIMIT 1),
              'intelligence_event'
            ) AS canonical_source
       FROM intelligence_events e
      WHERE e.last_seen_at >= $1
        AND e.last_seen_at < $2
        AND e.status <> 'archived'
      ORDER BY e.last_seen_at DESC`,
    [periodStart, periodEnd]
  );

  return res.rows.map((r) => ({
    id: r.id,
    signal_type: r.event_type,
    severity: r.severity,
    // The normalized, cited, display-safe event summary — never raw feed text.
    normalized_summary: r.executive_summary,
    affected_cve: r.affected_cve,
    affected_vendor: r.affected_vendor,
    source: r.canonical_source,
    ingestion_timestamp:
      r.last_seen_at instanceof Date ? r.last_seen_at.toISOString() : String(r.last_seen_at),
    cluster_key: r.canonical_key,
    raw_payload: { title: r.title, summary: r.executive_summary }
  }));
}
