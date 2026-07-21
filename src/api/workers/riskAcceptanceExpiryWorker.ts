/**
 * riskAcceptanceExpiryWorker.ts — an accepted risk comes back.
 *
 * A risk acceptance is a TIME-BOXED decision, never a permanent pardon. When its
 * review/expiration date passes, the Finding returns as live work and the organization
 * has to decide again — re-accept with fresh approval, or remediate.
 *
 * The closure derivation is already time-aware (SQL_ACCEPTANCE_BINDING tests
 * `expires_at >= CURRENT_DATE`), so a lapsed acceptance has ALREADY stopped closing its
 * finding before this worker runs. Posture never depends on a cron job having fired.
 * What the sweep does is MATERIALISE that:
 *
 *   - flip the record to 'expired' so it leaves the active-acceptance population,
 *   - write the audit trail for the governance record,
 *   - push the finding's stored operational_status back to reality, so the metrics
 *     tables agree with the derivation rather than lagging it.
 *
 * Self-gates on SECURELOGIC_RISK_ACCEPTANCE_ENABLED: with the flag off nothing was ever
 * closed by an acceptance, so there is nothing to reopen.
 *
 * Org-by-org, inside a per-tenant transaction. There is no cross-tenant sweep — a bug in
 * this loop must not be able to touch two customers.
 */

import { pg, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { sweepExpiredAcceptances } from "../lib/riskAcceptance.js";
import { riskAcceptanceEnabled } from "../lib/riskAcceptanceFeatureFlag.js";

/** Once an hour. Expiry is a DATE, so this is 24x more often than strictly needed. */
const INTERVAL_MS = 60 * 60 * 1000;

/** The sweep runs as the system, not as a person. */
const SYSTEM_ACTOR = { actorUserId: null, actorApiKeyId: null };

export async function runRiskAcceptanceExpirySweep(): Promise<{
  organizations: number;
  expired: number;
  reopened: number;
}> {
  if (!riskAcceptanceEnabled()) {
    return { organizations: 0, expired: 0, reopened: 0 };
  }

  // Only orgs that actually have a lapsed acceptance. The overwhelming majority of ticks
  // touch nothing, and this keeps the per-tenant transaction count at zero on those.
  const orgs = await pg.query<{ organization_id: string }>(
    `SELECT DISTINCT organization_id
       FROM finding_risk_acceptances
      WHERE state = 'approved'
        AND expires_at IS NOT NULL
        AND expires_at < CURRENT_DATE`
  );

  let expired = 0;
  let reopened = 0;

  for (const { organization_id: organizationId } of orgs.rows) {
    try {
      // One transaction per tenant: a failure on one customer's data cannot roll back or
      // corrupt another's, and RLS is scoped correctly for the reopen writes.
      const result = await withTenant(organizationId, () =>
        sweepExpiredAcceptances(organizationId, SYSTEM_ACTOR)
      );
      expired += result.expired;
      reopened += result.reopened;
    } catch (err) {
      // Keep going. One tenant's failure must not stop every other tenant's acceptances
      // from expiring — a stuck sweep silently keeps findings closed past their review
      // date, which is the exact governance failure this worker exists to prevent.
      logger.error(
        { event: "risk_acceptance_expiry_sweep_failed", organizationId, err },
        "Risk-acceptance expiry sweep failed for organization"
      );
    }
  }

  if (expired > 0) {
    logger.info(
      { event: "risk_acceptance_expiry_sweep_complete", organizations: orgs.rowCount, expired, reopened },
      "Risk-acceptance expiry sweep complete"
    );
  }

  return { organizations: orgs.rowCount ?? 0, expired, reopened };
}

export function startRiskAcceptanceExpiryWorker(): void {
  if (!riskAcceptanceEnabled()) {
    logger.info(
      { event: "risk_acceptance_expiry_worker_disabled" },
      "Risk-acceptance expiry worker: feature flag off — not started"
    );
    return;
  }

  const tick = (): void => {
    void runRiskAcceptanceExpirySweep().catch((err) => {
      logger.error({ event: "risk_acceptance_expiry_tick_failed", err }, "Expiry tick failed");
    });
  };

  // Not on boot: a deploy should not stampede the sweep across every tenant while the
  // process is still warming. The first tick lands one interval in.
  const timer = setInterval(tick, INTERVAL_MS);
  timer.unref?.();

  logger.info(
    { event: "risk_acceptance_expiry_worker_started", intervalMs: INTERVAL_MS },
    "Risk-acceptance expiry worker started"
  );
}
