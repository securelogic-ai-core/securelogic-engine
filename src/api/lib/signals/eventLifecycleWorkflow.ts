/**
 * eventLifecycleWorkflow.ts — workflow automation driven by canonical event
 * LIFECYCLE TRANSITIONS. Intelligence Pipeline Hardening (item 7; wires items 4 & 5).
 *
 * When an event reaches a trigger-worthy lifecycle state (confirmed /
 * actively_exploited / mitigated), the platform runs per-org follow-through
 * ONCE per transition:
 *   - reconcile the org's finding for the event (item 4 — one per org+event), and
 *   - evaluate + claim a notification per the policy + dedup ledger (item 5).
 *
 * The trigger fires from the event's lifecycle state — NOT from raw signal
 * ingestion — and is deduped by intelligence_event_workflow_triggers
 * (UNIQUE(event_id, to_state)), so it happens exactly once per (event, state).
 * The trigger row is CLAIMED (INSERT ON CONFLICT DO NOTHING) before the
 * follow-through runs, guaranteeing single execution even across concurrent
 * passes. GLOBAL discovery on the elevated channel; per-org work inside withTenant.
 *
 * DARK: self-gates on SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED.
 */

import { pgElevated } from "../../infra/postgres.js";
import { logger } from "../../infra/logger.js";
import { intelligenceEventsEnabled } from "./intelligenceEventsFeatureFlag.js";
import { reconcileEventFindingForOrg } from "./eventFindingStore.js";
import { evaluateAndClaimNotification } from "./eventNotificationStore.js";
import type { EventForFinding } from "./eventFinding.js";
import type { EventStatus } from "./intelligenceEventProjection.js";

/** Lifecycle states whose arrival warrants per-org follow-through. */
const TRIGGER_STATES = ["confirmed", "actively_exploited", "mitigated"];

interface TriggerEventRow {
  id: string;
  canonical_key: string;
  status: EventStatus;
  severity: string;
  event_type: string;
  title: string;
  executive_summary: string;
  affected_vendor: string | null;
  affected_cve: string | null;
}

export interface LifecycleWorkflowSummary {
  readonly transitions: number;
  readonly findings_reconciled: number;
  readonly notifications_claimed: number;
  readonly skipped?: string;
}

/**
 * Process pending lifecycle transitions: for each event that has reached a
 * trigger-worthy state and not yet fired for that state, claim the trigger and
 * run per-org follow-through for every org that tracks the affected vendor.
 */
export async function processEventLifecycleTriggers(
  batchLimit = 500
): Promise<LifecycleWorkflowSummary> {
  if (!intelligenceEventsEnabled()) {
    return { transitions: 0, findings_reconciled: 0, notifications_claimed: 0, skipped: "disabled" };
  }

  const events = (
    await pgElevated.query<TriggerEventRow>(
      `SELECT e.id, e.canonical_key, e.status, e.severity, e.event_type, e.title,
              e.executive_summary, e.affected_vendor, e.affected_cve
         FROM intelligence_events e
        WHERE e.status = ANY($1)
          AND e.affected_vendor IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM intelligence_event_workflow_triggers t
             WHERE t.event_id = e.id AND t.to_state = e.status
          )
        ORDER BY e.last_seen_at DESC
        LIMIT $2`,
      [TRIGGER_STATES, batchLimit]
    )
  ).rows;

  let transitions = 0;
  let findingsReconciled = 0;
  let notificationsClaimed = 0;

  for (const e of events) {
    // Claim the trigger for (event, state) — single execution guarantee.
    const claim = await pgElevated.query<{ id: string }>(
      `INSERT INTO intelligence_event_workflow_triggers (event_id, to_state)
       VALUES ($1, $2)
       ON CONFLICT (event_id, to_state) DO NOTHING
       RETURNING id`,
      [e.id, e.status]
    );
    if (claim.rows.length === 0) continue; // another pass claimed it
    transitions++;

    // Orgs impacted = those tracking the affected vendor (cross-org discovery).
    const orgs = (
      await pgElevated.query<{ organization_id: string }>(
        `SELECT DISTINCT organization_id FROM vendors
          WHERE lower(trim(name)) = lower(trim($1))`,
        [e.affected_vendor]
      )
    ).rows;

    const eventForFinding: EventForFinding = {
      event_id: e.id,
      title: e.title,
      executive_summary: e.executive_summary,
      severity: e.severity,
      status: e.status,
      event_type: e.event_type,
      affected_vendor: e.affected_vendor,
      affected_cve: e.affected_cve
    };

    for (const { organization_id: orgId } of orgs) {
      try {
        const finding = await reconcileEventFindingForOrg(orgId, eventForFinding);
        if (finding.action === "created" || finding.action === "updated") findingsReconciled++;

        const notification = await evaluateAndClaimNotification(
          orgId,
          { event_id: e.id, canonical_key: e.canonical_key, severity: e.severity, status: e.status },
          true // the org tracks the vendor → customer-impacting
        );
        if (notification.claimed) notificationsClaimed++;
      } catch (err) {
        logger.warn(
          { event: "event_lifecycle_followthrough_failed", eventId: e.id, orgId, err },
          "Event lifecycle follow-through failed for one org (non-fatal)"
        );
      }
    }
  }

  logger.info(
    { event: "event_lifecycle_workflow_complete", transitions, findingsReconciled, notificationsClaimed },
    "Event lifecycle workflow pass complete"
  );
  return {
    transitions,
    findings_reconciled: findingsReconciled,
    notifications_claimed: notificationsClaimed
  };
}
