/**
 * intelligenceEventStore.ts — persistence for the canonical Intelligence Event
 * projection. Intelligence Pipeline Hardening / IE.P4.
 *
 * Applies the pure planEventUpsert() plan to the three global tables
 * (intelligence_events / _sources / _timeline). GLOBAL + org-agnostic: runs on
 * the elevated (owner) channel, OUTSIDE any tenant scope (IE-AD-1). The pure
 * decision logic lives in intelligenceEventProjection.ts; this module is thin
 * orchestration + SQL.
 *
 * Concurrency: the event row is taken FOR UPDATE by canonical_key; creation
 * races are resolved by the canonical_key UNIQUE index + ON CONFLICT DO NOTHING
 * (the loser re-reads the winner's row and applies the update path).
 *
 * DARK: projectUnprojectedGlobalSignals() self-gates on
 * SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED and does zero DB work when off.
 */

import { withElevated } from "../../infra/postgres.js";
import { logger } from "../../infra/logger.js";
import {
  planEventUpsert,
  type IncomingSignal,
  type ExistingEventState,
  type EventStatus,
  type EventUpsertPlan
} from "./intelligenceEventProjection.js";
import { eventCanonicalKey } from "./intelligenceEventIdentity.js";
import { intelligenceEventsEnabled } from "./intelligenceEventsFeatureFlag.js";
import { ARCHIVE_AFTER_DAYS, RESOLVE_AFTER_DAYS } from "./intelligenceEventLifecycle.js";

/** Minimal DB surface — a PoolClient satisfies it; a fake satisfies it in tests. */
export interface EventStoreClient {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[] }>;
}

export interface ProjectionOutcome {
  readonly eventId: string;
  readonly canonicalKey: string;
  readonly isNew: boolean;
  readonly changed: boolean;
}

/** A cyber_signals row shape the projection consumes. */
export interface CyberSignalRow {
  id: string;
  source: string;
  signal_type: string;
  severity: string;
  normalized_summary: string;
  affected_vendor: string | null;
  affected_cve: string | null;
  external_id: string | null;
  dedup_hash: string;
  ingestion_timestamp: string | Date;
}

/** Map a cyber_signals row to the projection's IncomingSignal contract. */
export function toIncomingSignal(row: CyberSignalRow): IncomingSignal {
  return {
    cyber_signal_id: row.id,
    source: row.source,
    external_id: row.external_id,
    signal_type: row.signal_type,
    severity: row.severity,
    affected_cve: row.affected_cve,
    affected_vendor: row.affected_vendor,
    summary: row.normalized_summary,
    ingestion_timestamp: row.ingestion_timestamp,
    dedup_hash: row.dedup_hash
  };
}

interface EventRow {
  id: string;
  status: EventStatus;
  severity: string;
  source_count: number;
  revision: number;
  ever_exploited: boolean;
  ever_patched: boolean;
}

/** Load the current event + its corroboration facts, FOR UPDATE. */
async function loadExisting(
  client: EventStoreClient,
  canonicalKey: string
): Promise<{ eventId: string; state: ExistingEventState } | null> {
  const evt = await client.query<EventRow>(
    `SELECT id, status, severity, source_count, revision, ever_exploited, ever_patched
       FROM intelligence_events
      WHERE canonical_key = $1
      FOR UPDATE`,
    [canonicalKey]
  );
  if (evt.rows.length === 0) return null;
  const row = evt.rows[0]!;

  const src = await client.query<{ cyber_signal_id: string | null; source: string }>(
    `SELECT cyber_signal_id, source FROM intelligence_event_sources WHERE event_id = $1`,
    [row.id]
  );
  const contributingSignalIds = new Set<string>();
  const distinctSources = new Set<string>();
  for (const s of src.rows) {
    if (s.cyber_signal_id) contributingSignalIds.add(s.cyber_signal_id);
    distinctSources.add(String(s.source).toLowerCase().trim());
  }

  return {
    eventId: row.id,
    state: {
      id: row.id,
      status: row.status,
      severity: row.severity,
      source_count: row.source_count,
      revision: row.revision,
      ever_exploited: row.ever_exploited,
      ever_patched: row.ever_patched,
      contributingSignalIds,
      distinctSources
    }
  };
}

/** Insert the source-ledger op + timeline entries for an applied plan. */
async function applySourceAndTimeline(
  client: EventStoreClient,
  eventId: string,
  plan: EventUpsertPlan
): Promise<void> {
  if (plan.source) {
    await client.query(
      `INSERT INTO intelligence_event_sources
         (event_id, cyber_signal_id, source, external_id, relation, confidence, first_contributed_at, last_contributed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       ON CONFLICT (event_id, cyber_signal_id) DO UPDATE
         SET last_contributed_at = EXCLUDED.last_contributed_at,
             revision = intelligence_event_sources.revision + 1`,
      [
        eventId,
        plan.source.cyber_signal_id,
        plan.source.source,
        plan.source.external_id,
        plan.source.relation,
        plan.event.confidence,
        plan.source.contributed_at
      ]
    );
  }
  for (const t of plan.timeline) {
    await client.query(
      `INSERT INTO intelligence_event_timeline
         (event_id, entry_type, occurred_at, summary, source, cyber_signal_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [eventId, t.entry_type, t.occurred_at, t.summary, t.source, t.cyber_signal_id]
    );
  }
}

/**
 * Project a single signal into its canonical event, inside a transaction on the
 * provided client. Idempotent: a signal that already contributed is a no-op.
 * Exported so the isolation/integration test can drive it on the harness pool.
 */
export async function projectSignalWithClient(
  client: EventStoreClient,
  signal: IncomingSignal
): Promise<ProjectionOutcome> {
  const canonicalKey = eventCanonicalKey(signal);
  await client.query("BEGIN");
  try {
    let resolved = await loadExisting(client, canonicalKey);

    if (resolved === null) {
      // First sighting — create the event (canonical source).
      const plan = planEventUpsert(signal, null);
      const ins = await client.query<{ id: string }>(
        `INSERT INTO intelligence_events
           (canonical_key, title, executive_summary, summary_status, event_type, severity, status,
            affected_cve, affected_vendor, source_count, confidence, ever_exploited, ever_patched,
            first_seen_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)
         ON CONFLICT (canonical_key) DO NOTHING
         RETURNING id`,
        [
          canonicalKey,
          plan.event.title,
          plan.event.executive_summary,
          plan.event.summary_status,
          plan.event.event_type,
          plan.event.severity,
          plan.event.status,
          plan.event.affected_cve,
          plan.event.affected_vendor,
          plan.event.source_count,
          plan.event.confidence,
          plan.event.ever_exploited,
          plan.event.ever_patched,
          signal.ingestion_timestamp
        ]
      );
      if (ins.rows.length > 0) {
        const eventId = ins.rows[0]!.id;
        await applySourceAndTimeline(client, eventId, plan);
        await client.query("COMMIT");
        return { eventId, canonicalKey, isNew: true, changed: true };
      }
      // Lost the creation race — fall through to the update path.
      resolved = await loadExisting(client, canonicalKey);
      if (resolved === null) throw new Error("event vanished after ON CONFLICT");
    }

    // Update path (existed, or race-resolved).
    const plan = planEventUpsert(signal, resolved.state);
    if (plan.changed) {
      await client.query(
        `UPDATE intelligence_events
            SET severity = $2,
                status = $3,
                source_count = $4,
                confidence = $5,
                affected_cve = COALESCE(affected_cve, $6),
                affected_vendor = COALESCE(affected_vendor, $7),
                ever_exploited = $8,
                ever_patched = $9,
                last_seen_at = $10,
                revision = revision + 1,
                updated_at = NOW()
          WHERE id = $1`,
        [
          resolved.eventId,
          plan.event.severity,
          plan.event.status,
          plan.event.source_count,
          plan.event.confidence,
          plan.event.affected_cve,
          plan.event.affected_vendor,
          plan.event.ever_exploited,
          plan.event.ever_patched,
          signal.ingestion_timestamp
        ]
      );
      await applySourceAndTimeline(client, resolved.eventId, plan);
    }
    await client.query("COMMIT");
    return { eventId: resolved.eventId, canonicalKey, isNew: false, changed: plan.changed };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* client may be unusable; caller discards it */
    }
    throw err;
  }
}

export interface BatchProjectionSummary {
  readonly projected: number;
  readonly created: number;
  readonly corroborated: number;
  readonly skipped?: string;
}

/**
 * Project every global (organization_id IS NULL) cyber_signal that has not yet
 * contributed to an event. Idempotent and terminating (a projected signal gains
 * a source row and is excluded from the next batch). GLOBAL: reads only NULL-org
 * signals — the per-org copies are duplicates of the same upstream items and are
 * intentionally NOT re-counted as separate sources (IE-AD-1).
 *
 * Self-gates on the flag: zero DB work when SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED
 * is off. Best-effort — a per-signal failure is logged and skipped.
 */
export async function projectUnprojectedGlobalSignals(
  batchLimit = 500,
  maxBatches = 50
): Promise<BatchProjectionSummary> {
  if (!intelligenceEventsEnabled()) {
    return { projected: 0, created: 0, corroborated: 0, skipped: "disabled" };
  }

  return withElevated(async (client) => {
    let projected = 0;
    let created = 0;
    let corroborated = 0;

    for (let batch = 0; batch < maxBatches; batch++) {
      const { rows } = await client.query<CyberSignalRow>(
        `SELECT cs.id, cs.source, cs.signal_type, cs.severity, cs.normalized_summary,
                cs.affected_vendor, cs.affected_cve, cs.external_id, cs.dedup_hash, cs.ingestion_timestamp
           FROM cyber_signals cs
          WHERE cs.organization_id IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM intelligence_event_sources s WHERE s.cyber_signal_id = cs.id
            )
          ORDER BY cs.ingestion_timestamp ASC, cs.id ASC
          LIMIT $1`,
        [batchLimit]
      );
      if (rows.length === 0) break;

      let failures = 0;
      for (const row of rows) {
        try {
          const outcome = await projectSignalWithClient(client, toIncomingSignal(row));
          projected++;
          if (outcome.isNew) created++;
          else if (outcome.changed) corroborated++;
        } catch (err) {
          failures++;
          logger.warn(
            { event: "intelligence_event_projection_failed", signalId: row.id, err },
            "Intelligence Event projection failed for a signal — skipping (non-fatal)"
          );
        }
      }

      // No progress in a full batch (every row errored) — stop to avoid a loop.
      if (failures === rows.length) break;
      if (rows.length < batchLimit) break;
    }

    logger.info(
      { event: "intelligence_event_projection_complete", projected, created, corroborated },
      "Intelligence Event projection pass complete"
    );
    return { projected, created, corroborated };
  });
}

/**
 * Age the lifecycle of quiet events: mitigated → resolved after RESOLVE_AFTER_DAYS,
 * any non-active → archived after ARCHIVE_AFTER_DAYS, computed from last_seen_at.
 * Never touches actively_exploited events. A status change appends a timeline
 * entry. Deterministic in the DB clock; idempotent (only rows whose state would
 * change are updated). Self-gates on the flag. GLOBAL / elevated.
 */
export async function ageIntelligenceEvents(): Promise<{ resolved: number; archived: number; skipped?: string }> {
  if (!intelligenceEventsEnabled()) return { resolved: 0, archived: 0, skipped: "disabled" };

  return withElevated(async (client) => {
    // Archive: any non-active event quiet for ARCHIVE_AFTER_DAYS.
    const archived = await client.query<{ id: string }>(
      `UPDATE intelligence_events
          SET status = 'archived', revision = revision + 1, updated_at = NOW()
        WHERE status NOT IN ('archived', 'actively_exploited')
          AND last_seen_at < NOW() - ($1 || ' days')::interval
        RETURNING id`,
      [String(ARCHIVE_AFTER_DAYS)]
    );
    // Resolve: mitigated events quiet for RESOLVE_AFTER_DAYS (but not yet archive-old).
    const resolved = await client.query<{ id: string }>(
      `UPDATE intelligence_events
          SET status = 'resolved', revision = revision + 1, updated_at = NOW()
        WHERE status = 'mitigated'
          AND last_seen_at < NOW() - ($1 || ' days')::interval
        RETURNING id`,
      [String(RESOLVE_AFTER_DAYS)]
    );

    for (const r of [...archived.rows, ...resolved.rows]) {
      const isArchive = archived.rows.some((a) => a.id === r.id);
      await client.query(
        `INSERT INTO intelligence_event_timeline (event_id, entry_type, occurred_at, summary, source)
         VALUES ($1, 'status_change', NOW(), $2, NULL)`,
        [r.id, isArchive ? "Event archived after prolonged inactivity." : "Event resolved after mitigation and inactivity."]
      );
    }

    logger.info(
      { event: "intelligence_event_aging_complete", resolved: resolved.rowCount ?? 0, archived: archived.rowCount ?? 0 },
      "Intelligence Event aging pass complete"
    );
    return { resolved: resolved.rowCount ?? 0, archived: archived.rowCount ?? 0 };
  });
}
