/**
 * billingDunningCycle.ts — the durable record of one delinquency cycle.
 *
 * Stripe sends invoice.payment_failed on EVERY retry — up to 8 across a 2-week
 * Smart Retries window. Emailing straight off the event would send a customer
 * eight "your payment failed" notices. The cycle row is what makes each
 * notification happen exactly once: the first failure opens the row, every
 * retry conflicts with it, and each stage is CLAIMED by a conditional UPDATE
 * before its email is sent.
 *
 * Claim-then-send, not send-then-record: a crash between the two costs at most
 * one UN-SENT notice. That is the safe direction — a missing warning is
 * recoverable by the next stage or by Stripe's own emails, a duplicate one is
 * not recoverable at all.
 *
 * ALL WRITES USE THE ELEVATED CHANNEL, deliberately. The writer is the Stripe
 * webhook, which is a provider callback with no tenant scope — there is no
 * request-scoped org to run as. The table still carries an RLS policy so that
 * any READ surface added later is org-scoped by construction.
 */

import { pgElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";

/** The notification stages a cycle can carry, by grace-day offset. */
export type DunningStage = 0 | 7 | 14;

const STAGE_COLUMN: Record<DunningStage, string> = {
  0: "notified_day0_at",
  7: "notified_day7_at",
  14: "notified_day14_at",
};

export interface OpenCycleArgs {
  organizationId: string;
  /** organizations.payment_failed_at — the FIRST failure of this cycle. */
  cycleStartedAt: Date | string;
  subscriptionId: string | null;
  eventId: string | null;
}

export interface OpenCycleResult {
  cycleId: string | null;
  /** True only for the failure that OPENED this cycle — i.e. not a retry. */
  isNew: boolean;
}

/**
 * Open the cycle, or return the existing one.
 *
 * `isNew` is the answer to "is this the first failure of this delinquency?",
 * which is not otherwise knowable: every retry carries the same
 * organizations.payment_failed_at (ruling R1 makes that stamp write-once), so
 * the UNIQUE (organization_id, cycle_started_at) constraint is what separates
 * the opening failure from its retries.
 */
export async function openDunningCycle(args: OpenCycleArgs): Promise<OpenCycleResult> {
  try {
    const inserted = await pgElevated.query<{ id: string }>(
      `INSERT INTO billing_dunning_cycles
         (organization_id, cycle_started_at, stripe_subscription_id, first_event_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, cycle_started_at) DO NOTHING
       RETURNING id`,
      [args.organizationId, args.cycleStartedAt, args.subscriptionId, args.eventId]
    );

    if (inserted.rows[0]) {
      return { cycleId: inserted.rows[0].id, isNew: true };
    }

    const existing = await pgElevated.query<{ id: string }>(
      `SELECT id FROM billing_dunning_cycles
        WHERE organization_id = $1 AND cycle_started_at = $2
        LIMIT 1`,
      [args.organizationId, args.cycleStartedAt]
    );
    return { cycleId: existing.rows[0]?.id ?? null, isNew: false };
  } catch (err) {
    // Never fatal. A cycle we failed to record is a lost notification and a
    // lost data point; it is not a reason to fail the webhook and have Stripe
    // retry the whole event, which would re-run the entitlement writes.
    logger.error(
      { event: "billing_dunning_cycle_open_failed", orgId: args.organizationId, err },
      "billingDunningCycle: could not open cycle (non-fatal)"
    );
    return { cycleId: null, isNew: false };
  }
}

/**
 * Claim one notification stage. Returns true to EXACTLY ONE caller.
 *
 * The conditional UPDATE is the concurrency control: `WHERE <stage> IS NULL`
 * means a second worker, a re-delivered event or a second engine instance loses
 * the race atomically in Postgres rather than racing in application code.
 */
export async function claimDunningStage(
  cycleId: string,
  stage: DunningStage
): Promise<boolean> {
  const column = STAGE_COLUMN[stage];
  try {
    const result = await pgElevated.query(
      `UPDATE billing_dunning_cycles
          SET ${column} = NOW()
        WHERE id = $1 AND ${column} IS NULL
          AND recovered_at IS NULL
        RETURNING id`,
      [cycleId]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (err) {
    logger.error(
      { event: "billing_dunning_stage_claim_failed", cycleId, stage, err },
      "billingDunningCycle: stage claim failed — notification skipped (non-fatal)"
    );
    return false;
  }
}

/**
 * Close every open cycle for an org as recovered. Returns the ids closed —
 * a non-empty result is the CLAIM for the "payment recovered" email, so the
 * confirmation is sent once even though recovery can be observed more than
 * once (invoice.paid and a subsequent subscription.updated(active) both
 * restore entitlement).
 *
 * Plural by design: an org with more than one open cycle is already anomalous,
 * and closing all of them is the convergent answer.
 */
export async function markCyclesRecovered(organizationId: string): Promise<string[]> {
  try {
    const result = await pgElevated.query<{ id: string }>(
      `UPDATE billing_dunning_cycles
          SET recovered_at = NOW()
        WHERE organization_id = $1
          AND recovered_at IS NULL
          AND lapsed_at IS NULL
        RETURNING id`,
      [organizationId]
    );
    return result.rows.map((r) => r.id);
  } catch (err) {
    logger.error(
      { event: "billing_dunning_cycle_recover_failed", orgId: organizationId, err },
      "billingDunningCycle: could not mark cycles recovered (non-fatal)"
    );
    return [];
  }
}

/**
 * Close a cycle as lapsed. Idempotent, and never overwrites a recovery: a cycle
 * that recovered is not retroactively lapsed by a late terminal event.
 */
export async function markCycleLapsed(cycleId: string): Promise<boolean> {
  try {
    const result = await pgElevated.query(
      `UPDATE billing_dunning_cycles
          SET lapsed_at = NOW()
        WHERE id = $1 AND lapsed_at IS NULL AND recovered_at IS NULL
        RETURNING id`,
      [cycleId]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (err) {
    logger.error(
      { event: "billing_dunning_cycle_lapse_failed", cycleId, err },
      "billingDunningCycle: could not mark cycle lapsed (non-fatal)"
    );
    return false;
  }
}
