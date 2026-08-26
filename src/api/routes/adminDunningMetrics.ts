/**
 * adminDunningMetrics.ts — GET /api/admin/billing/dunning-metrics
 *
 * "Did dunning work?" is a business question, and until this endpoint it had no
 * answer. `payment_failed_at` is a single mutable flag that tells you an org is
 * delinquent RIGHT NOW and nothing about the outcome of any past delinquency:
 * an org that failed, was warned, paid and carried on is indistinguishable from
 * one that never failed at all, because the column is cleared on recovery. So
 * the two conclusions "our dunning saves customers" and "our dunning saves
 * nobody" were equally consistent with the data, and one of them would wrongly
 * justify cutting the emails.
 *
 * billing_dunning_cycles (20261028) is the durable record that closes that gap.
 * This is its read surface.
 *
 * The rate is deliberately computed over CLOSED cycles only. Counting open ones
 * in the denominator would make the number sag every time a new delinquency
 * starts and recover as it resolves — an artefact of timing rather than a fact
 * about the business. Open cycles are reported separately, because "how many
 * customers are delinquent right now" is a different and equally operational
 * question.
 *
 * M-1 PR-2: staff surface behind requireAdminKey, cross-org aggregate over
 * rows that no tenant GUC can scope — the elevated owner channel is the correct
 * disposition. Nothing here is per-customer: ids and counts only, no names, no
 * emails, no amounts.
 */

import { Router } from "express";

import { pgElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";

const router = Router();

const DEFAULT_WINDOW_DAYS = 90;
const MAX_WINDOW_DAYS = 730;

function parseWindowDays(value: unknown): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WINDOW_DAYS;
  return Math.min(Math.floor(parsed), MAX_WINDOW_DAYS);
}

router.get("/billing/dunning-metrics", async (req, res) => {
  try {
    const windowDays = parseWindowDays(req.query.windowDays);

    const { rows } = await pgElevated.query<{
      cycles: string;
      recovered: string;
      lapsed_unrecovered: string;
      open: string;
      recovered_after_lockout: string;
      notified_day0: string;
      notified_day7: string;
      notified_day14: string;
      median_hours_to_recovery: string | null;
    }>(
      `
      SELECT
        COUNT(*)::text                                                        AS cycles,
        COUNT(*) FILTER (WHERE recovered_at IS NOT NULL)::text                AS recovered,
        COUNT(*) FILTER (WHERE recovered_at IS NULL
                           AND lapsed_at IS NOT NULL)::text                   AS lapsed_unrecovered,
        COUNT(*) FILTER (WHERE recovered_at IS NULL
                           AND lapsed_at IS NULL)::text                       AS open,
        -- The saves that mattered most: the customer had already lost access.
        COUNT(*) FILTER (WHERE recovered_at IS NOT NULL
                           AND lapsed_at IS NOT NULL)::text                   AS recovered_after_lockout,
        COUNT(*) FILTER (WHERE notified_day0_at  IS NOT NULL)::text           AS notified_day0,
        COUNT(*) FILTER (WHERE notified_day7_at  IS NOT NULL)::text           AS notified_day7,
        COUNT(*) FILTER (WHERE notified_day14_at IS NOT NULL)::text           AS notified_day14,
        (PERCENTILE_CONT(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (recovered_at - cycle_started_at)) / 3600.0
         ) FILTER (WHERE recovered_at IS NOT NULL))::text                     AS median_hours_to_recovery
      FROM billing_dunning_cycles
      WHERE cycle_started_at >= NOW() - ($1 || ' days')::interval
      `,
      [String(windowDays)]
    );

    const r = rows[0]!;
    const cycles = Number(r.cycles);
    const recovered = Number(r.recovered);
    const lapsed = Number(r.lapsed_unrecovered);
    const closed = recovered + lapsed;

    res.status(200).json({
      window_days: windowDays,
      cycles,
      recovered,
      lapsed_unrecovered: lapsed,
      open: Number(r.open),
      closed,
      // null rather than 0 when nothing has closed yet: "no cycle has finished"
      // and "every cycle failed" are opposite conclusions and must not share a
      // representation.
      recovery_rate: closed > 0 ? Number((recovered / closed).toFixed(4)) : null,
      recovered_after_lockout: Number(r.recovered_after_lockout),
      notified: {
        day0: Number(r.notified_day0),
        day7: Number(r.notified_day7),
        day14: Number(r.notified_day14),
      },
      median_hours_to_recovery:
        r.median_hours_to_recovery === null ? null : Number(Number(r.median_hours_to_recovery).toFixed(2)),
    });
  } catch (err) {
    logger.error(
      { event: "admin_dunning_metrics_failed", err },
      "GET /api/admin/billing/dunning-metrics failed"
    );
    res.status(500).json({ error: "dunning_metrics_failed" });
  }
});

export default router;
