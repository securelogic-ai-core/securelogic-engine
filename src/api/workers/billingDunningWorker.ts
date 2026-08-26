/**
 * billingDunningWorker.ts — the reconciling half of the dunning lifecycle.
 *
 * WHAT THIS IS NOT: it is not what decides whether a delinquent customer has
 * access. That is derived on every request in attachOrganizationContext, from
 * organizations.payment_failed_at, by the same graceWindow function this sweep
 * uses. The consequence is the reason this can be a small in-process worker
 * rather than dedicated infrastructure:
 *
 *   A MISSED, LATE, CRASHED OR DUPLICATED RUN CANNOT LEAVE A CUSTOMER WRONGLY
 *   ENTITLED. Access is computed from state, not from whether a job fired.
 *
 * That is the same stance riskAcceptanceExpiryWorker takes in its own header —
 * "posture never depends on a cron job having fired" — applied to billing.
 *
 * So this sweep has three narrower jobs:
 *
 *   1. SEND the Day 7 and Day 14 notices, which are not event-shaped: Stripe's
 *      retry timing is not ours, and on a hard decline it may stop emitting
 *      failure events entirely, so an attempt-driven scheme could go silent
 *      after the first notice and the customer would lose access with one
 *      warning.
 *   2. MATERIALISE the downgrade for lapsed organizations, so exports,
 *      dashboards and reports agree with what enforcement is already doing.
 *   3. ALERT when the backstop bites. A backstop firing always means a terminal
 *      Stripe webhook we never received — it is a signal about the integration,
 *      not routine work.
 *
 * IDEMPOTENCY. Every write here is either a converging UPDATE guarded by a
 * WHERE clause, or a claim-then-act against a unique constraint. The downgrade
 * is naturally idempotent; an email is not, so each notification stage is
 * CLAIMED (set from NULL) before it is sent. A second runner, a duplicate tick
 * or a second engine instance loses that race atomically in Postgres.
 *
 * CROSS-ORG BY DESIGN. The candidate scan spans tenants — no organization is
 * known until a row is read — so it runs on the elevated channel, the canonical
 * worker enumeration pattern used by every sibling sweep in this directory.
 *
 * SINGLE INSTANCE TODAY. render.yaml sets no numInstances, so every service
 * runs one. That is true now and could quietly stop being true, which is
 * exactly why the stage claim is not optional.
 */

import { pgElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { graceState, graceEnabled, graceDays } from "../lib/graceWindow.js";
import { claimDunningStage, markCycleLapsed } from "../lib/billingDunningCycle.js";
import { sendDunningEmails } from "../lib/billingDunningEmail.js";

/** Hourly. Grace boundaries have day granularity, so this is ~24x more often
 *  than strictly needed — which is what makes any single missed tick a
 *  non-event, and matches exportFilePurgeWorker / riskAcceptanceExpiryWorker. */
const INTERVAL_MS = 60 * 60 * 1000;

/** Bounded so a pathological data condition cannot turn one tick into an
 *  unbounded scan. Untouched candidates are simply picked up next tick. */
const BATCH_SIZE = 200;

const DAY_MS = 86_400_000;

interface OpenCycle {
  cycle_id: string;
  organization_id: string;
  cycle_started_at: Date;
  notified_day7_at: Date | null;
  notified_day14_at: Date | null;
  entitlement_level: string | null;
  payment_failed_at: Date | null;
  stripe_subscription_status: string | null;
}

export interface DunningSweepResult {
  candidates: number;
  notified7: number;
  notified14: number;
  materialized: number;
  backstopped: number;
  skipped_disabled: boolean;
}

const EMPTY: DunningSweepResult = {
  candidates: 0,
  notified7: 0,
  notified14: 0,
  materialized: 0,
  backstopped: 0,
  skipped_disabled: false,
};

/**
 * One reconciliation pass.
 *
 * Reconciliation, not scheduling: nothing here asks "is it 7 days since the
 * last run" or "did I already handle this tick". Every decision is recomputed
 * from (cycle_started_at, now, the stage columns), so running late, twice, or
 * not at all converges to the same state.
 */
export async function runDunningSweep(
  now: Date = new Date()
): Promise<DunningSweepResult> {
  if (!graceEnabled()) {
    // With grace off there is no window to expire and no Day 7/14 to send:
    // past_due revokes immediately, exactly as it does today.
    return { ...EMPTY, skipped_disabled: true };
  }

  const windowDays = graceDays();

  const { rows } = await pgElevated.query<OpenCycle>(
    `SELECT c.id                            AS cycle_id,
            c.organization_id,
            c.cycle_started_at,
            c.notified_day7_at,
            c.notified_day14_at,
            o.entitlement_level,
            o.payment_failed_at,
            o.stripe_subscription_status
       FROM billing_dunning_cycles c
       JOIN organizations o ON o.id = c.organization_id
      WHERE c.recovered_at IS NULL
        AND c.lapsed_at IS NULL
      ORDER BY c.cycle_started_at ASC
      LIMIT $1`,
    [BATCH_SIZE]
  );

  const result: DunningSweepResult = { ...EMPTY, candidates: rows.length };

  for (const cycle of rows) {
    try {
      // A cycle whose org has already been cleared is stale bookkeeping: the
      // recovery path closes cycles, so this can only happen if a write was
      // lost. Close it rather than notifying a customer who has paid.
      if (!cycle.payment_failed_at) {
        await pgElevated.query(
          `UPDATE billing_dunning_cycles
              SET recovered_at = NOW()
            WHERE id = $1 AND recovered_at IS NULL`,
          [cycle.cycle_id]
        );
        logger.warn(
          { event: "billing_dunning_cycle_orphaned", orgId: cycle.organization_id, cycleId: cycle.cycle_id },
          "dunning sweep: cycle open but the org has no payment failure — closing as recovered"
        );
        continue;
      }

      const state = graceState({
        paymentFailedAt: cycle.payment_failed_at,
        subscriptionStatus: cycle.stripe_subscription_status,
      }, now);

      const ageDays = (now.getTime() - new Date(cycle.cycle_started_at).getTime()) / DAY_MS;

      if (state === "in_grace") {
        // Notifications are due by ELAPSED TIME, recomputed every pass. A sweep
        // that missed the day-7 boundary sends it on the next tick rather than
        // skipping it — the stage claim, not the schedule, is what stops a
        // duplicate.
        //
        // Day 14 is checked first so a long outage that spans both boundaries
        // sends the FINAL notice rather than a stale mid-cycle one; claiming
        // day 14 leaves day 7 unclaimed forever, which is the honest record.
        if (ageDays >= windowDays - 1 && !cycle.notified_day14_at) {
          if (await claimDunningStage(cycle.cycle_id, 14)) {
            await sendDunningEmails({
              orgId: cycle.organization_id,
              cycleStartedAt: cycle.payment_failed_at,
              subscriptionStatus: cycle.stripe_subscription_status,
              stage: 14,
            });
            result.notified14 += 1;
          }
        } else if (ageDays >= 7 && !cycle.notified_day7_at) {
          if (await claimDunningStage(cycle.cycle_id, 7)) {
            await sendDunningEmails({
              orgId: cycle.organization_id,
              cycleStartedAt: cycle.payment_failed_at,
              subscriptionStatus: cycle.stripe_subscription_status,
              stage: 7,
            });
            result.notified7 += 1;
          }
        }
        continue;
      }

      if (state === "lapsed") {
        // Enforcement has ALREADY withdrawn access — attachOrganizationContext
        // derived it on the first request after the window elapsed. This only
        // makes the stored projection agree, so a report does not show premium
        // for an org the product is 403ing.
        const materialized = await pgElevated.query(
          `UPDATE organizations
              SET entitlement_level = 'starter',
                  plan              = 'starter'
            WHERE id = $1
              AND entitlement_level <> 'starter'`,
          [cycle.organization_id]
        );
        if ((materialized.rowCount ?? 0) > 0) result.materialized += 1;

        await markCycleLapsed(cycle.cycle_id);

        // The backstop distinction that matters operationally: the window
        // elapsed while Stripe was still reporting a non-terminal state, which
        // means the terminal webhook never arrived. Routine lapses (Stripe
        // told us it canceled) are not alerts; this is.
        const terminalKnown =
          cycle.stripe_subscription_status === "canceled" ||
          cycle.stripe_subscription_status === "unpaid" ||
          cycle.stripe_subscription_status === "incomplete_expired";

        if (!terminalKnown) {
          result.backstopped += 1;
          logger.error(
            {
              event: "billing_dunning_backstop_fired",
              orgId: cycle.organization_id,
              cycleId: cycle.cycle_id,
              cycleStartedAt: cycle.cycle_started_at,
              ageDays: Math.round(ageDays * 10) / 10,
              subscriptionStatus: cycle.stripe_subscription_status,
            },
            "dunning sweep: grace expired with no terminal Stripe event — the webhook that should have ended this cycle never arrived"
          );
        } else {
          logger.warn(
            {
              event: "billing_dunning_lapsed",
              orgId: cycle.organization_id,
              cycleId: cycle.cycle_id,
              subscriptionStatus: cycle.stripe_subscription_status,
            },
            "dunning sweep: cycle lapsed — access withdrawn"
          );
        }
      }
    } catch (err) {
      // One organization's failure must never stop the batch. The row stays
      // uncorrected and the next tick picks it up; nothing here is a one-shot.
      logger.error(
        { event: "billing_dunning_sweep_item_failed", orgId: cycle.organization_id, cycleId: cycle.cycle_id, err },
        "dunning sweep: one cycle failed; continuing"
      );
    }
  }

  if (result.candidates > 0) {
    logger.info(
      { event: "billing_dunning_sweep_complete", ...result },
      "dunning sweep complete"
    );
  }

  return result;
}

export function startBillingDunningWorker(): void {
  if (!graceEnabled()) {
    logger.info(
      { event: "billing_dunning_worker_disabled" },
      "Billing dunning worker: SECURELOGIC_BILLING_GRACE_ENABLED not set — not starting"
    );
    return;
  }

  const tick = (): void => {
    runDunningSweep().catch((err) =>
      logger.error({ event: "billing_dunning_sweep_failed", err }, "Dunning sweep failed")
    );
  };

  setTimeout(tick, 60_000).unref?.();
  setInterval(tick, INTERVAL_MS).unref?.();

  logger.info(
    { event: "billing_dunning_worker_started", intervalMs: INTERVAL_MS },
    "Billing dunning worker started"
  );
}
