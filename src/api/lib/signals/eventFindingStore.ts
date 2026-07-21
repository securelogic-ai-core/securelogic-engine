/**
 * eventFindingStore.ts — persist event→finding reconciliation. Intelligence
 * Pipeline Hardening / IE.P6 (memo IE-AD-7).
 *
 * Creates/updates ONE finding per (organization, intelligence_event) —
 * dedup-by-update via the partial unique index (org, source_id) WHERE
 * source_type='intelligence_event'. An evolving event updates its finding
 * instead of creating a duplicate (goal item 7). Findings are ORG-scoped, so
 * this runs inside withTenant(orgId); the global event is the shared spine.
 *
 * Relevance ("actionable organizational risk"): the org tracks the event's
 * affected vendor. This mirrors the legacy matcher, which only creates a finding
 * on a vendor/AI-system match — a global CVE with no org linkage does NOT spawn
 * a finding. Richer relevance (AI systems, assets, fuzzy match) is a follow-up.
 *
 * DARK: self-gates on SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED. Legacy per-signal
 * findings (source_type='cyber_signal') are untouched.
 */

import { pg, withTenant } from "../../infra/postgres.js";
import { logger } from "../../infra/logger.js";
import { intelligenceEventsEnabled } from "./intelligenceEventsFeatureFlag.js";
import { planFindingUpsert, type EventForFinding, type ExistingFinding } from "./eventFinding.js";
import { resolveSlaDueDateWith } from "../findingSlaPolicyRules.js";

export type ReconcileAction = "created" | "updated" | "noop" | "not_relevant" | "disabled";

export interface ReconcileOutcome {
  readonly action: ReconcileAction;
  readonly findingId?: string | undefined;
}

/** Tenant-aware query surface (the `pg` proxy inside withTenant satisfies it). */
interface TenantQueryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** Does this org track the event's affected vendor? (actionable-risk gate) */
async function isRelevantToOrg(
  client: TenantQueryable,
  orgId: string,
  event: EventForFinding
): Promise<boolean> {
  if (!event.affected_vendor || event.affected_vendor.trim() === "") return false;
  const r = await client.query(
    `SELECT 1 FROM vendors
      WHERE organization_id = $1
        AND lower(trim(name)) = lower(trim($2))
      LIMIT 1`,
    [orgId, event.affected_vendor]
  );
  return r.rows.length > 0;
}

/** Upsert the one event-sourced finding for (org, event). Assumes relevance. */
async function upsertFinding(
  client: TenantQueryable,
  orgId: string,
  event: EventForFinding
): Promise<ReconcileOutcome> {
  const existingRes = await client.query<ExistingFinding>(
    `SELECT id, severity, title, description, status
       FROM findings
      WHERE organization_id = $1 AND source_type = 'intelligence_event' AND source_id = $2
      LIMIT 1`,
    [orgId, event.event_id]
  );
  const existing = existingRes.rows[0] ?? null;
  const plan = planFindingUpsert(event, existing);

  if (plan.action === "noop") {
    return { action: "noop", findingId: existing?.id };
  }

  // SLA policy (20260903): automated findings get an org-policy due date at
  // CREATION only — the ON CONFLICT update never touches due_date, so a
  // human-adjusted SLA is never clobbered by an evolving event.
  const slaDueDate = existing ? null : await resolveSlaDueDateWith(client, orgId, plan.severity);

  const res = await client.query<{ id: string }>(
    `INSERT INTO findings
       (organization_id, assessment_id, source_type, source_id, title, description, severity, domain, priority, status, due_date)
     VALUES ($1, NULL, 'intelligence_event', $2, $3, $4, $5, $6, $7, 'open', $8)
     ON CONFLICT (organization_id, source_id) WHERE source_type = 'intelligence_event'
     DO UPDATE SET
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       severity = EXCLUDED.severity,
       domain = EXCLUDED.domain,
       priority = EXCLUDED.priority,
       updated_at = NOW()
     RETURNING id`,
    [orgId, event.event_id, plan.title, plan.description, plan.severity, plan.domain, plan.priority, slaDueDate]
  );

  return { action: existing ? "updated" : "created", findingId: res.rows[0]?.id };
}

/**
 * Reconcile the finding for one (org, event). Returns 'disabled' when the flag
 * is off, 'not_relevant' when the org does not track the vendor, else the
 * create/update/noop outcome. Idempotent — re-running never duplicates.
 */
export async function reconcileEventFindingForOrg(
  orgId: string,
  event: EventForFinding
): Promise<ReconcileOutcome> {
  if (!intelligenceEventsEnabled()) return { action: "disabled" };
  return withTenant(orgId, async () => {
    if (!(await isRelevantToOrg(pg, orgId, event))) return { action: "not_relevant" };
    return upsertFinding(pg, orgId, event);
  });
}

export interface OrgReconcileSummary {
  readonly reconciled: number;
  readonly created: number;
  readonly updated: number;
  readonly skipped?: string;
}

/**
 * Reconcile findings for every canonical event whose affected vendor this org
 * tracks. Dark, idempotent. Intended for a per-org cadence / on enablement.
 */
export async function reconcileOrgEventFindings(orgId: string): Promise<OrgReconcileSummary> {
  if (!intelligenceEventsEnabled()) return { reconciled: 0, created: 0, updated: 0, skipped: "disabled" };

  return withTenant(orgId, async () => {
    const events = await pg.query<EventForFinding>(
      `SELECT e.id AS event_id, e.title, e.executive_summary, e.severity, e.status,
              e.event_type, e.affected_vendor, e.affected_cve
         FROM intelligence_events e
         JOIN vendors v
           ON v.organization_id = $1
          AND lower(trim(v.name)) = lower(trim(e.affected_vendor))
        WHERE e.affected_vendor IS NOT NULL`,
      [orgId]
    );

    let created = 0;
    let updated = 0;
    for (const event of events.rows) {
      try {
        const outcome = await upsertFinding(pg, orgId, event);
        if (outcome.action === "created") created++;
        else if (outcome.action === "updated") updated++;
      } catch (err) {
        logger.warn(
          { event: "event_finding_reconcile_failed", orgId, eventId: event.event_id, err },
          "Event→finding reconcile failed for one event (non-fatal)"
        );
      }
    }

    logger.info(
      { event: "event_finding_reconcile_complete", orgId, reconciled: events.rows.length, created, updated },
      "Event→finding reconcile pass complete"
    );
    return { reconciled: events.rows.length, created, updated };
  });
}
