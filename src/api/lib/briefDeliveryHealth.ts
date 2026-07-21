/**
 * briefDeliveryHealth.ts — turns a silent Intelligence Brief no-op into a loud
 * operator signal.
 *
 * The weekly Brief scheduler (briefScheduler.runScheduler) can complete
 * "successfully" while delivering zero emails — no subscribers, every item
 * filtered out, or every Resend call failing (e.g. an unverified sender
 * domain). Before this module those outcomes were only info/error log lines;
 * nothing paged an operator, so a broken send week could pass unnoticed.
 *
 * evaluateDeliveryHealth() is a PURE function of the run summary + whether the
 * run was on the weekly send day. It classifies the run as ok / warn / error
 * with a stable machine reason. maybeAlertBriefDelivery() wires that verdict to
 * the existing operator webhook (sendFailureAlert), best-effort: a webhook that
 * is unset is a no-op, and an alert that throws never breaks the scheduler run.
 *
 * Scope discipline: this only OBSERVES. It never changes what is sent, and it
 * is intentionally silent on non-send-day (generation-only) runs, which deliver
 * no email by design.
 */

import { logger } from "../infra/logger.js";
import { sendFailureAlert } from "../infra/alerting.js";
import type { SchedulerRunSummary } from "./briefScheduler.js";

export type DeliverySeverity = "ok" | "warn" | "error";

export type DeliveryHealth = {
  severity: DeliverySeverity;
  /** Stable machine-readable classification (empty string when ok). */
  reason: string;
  /** Human-readable one-liner for the operator alert. */
  message: string;
};

/**
 * Classify a scheduler run's delivery outcome.
 *
 * Precedence (first match wins):
 *   1. non-send-day               → ok      (generation-only run; no email expected)
 *   2. orgs query failed          → error   (could not even enumerate orgs)
 *   3. emails_failed > 0          → error   (Resend/env problem — the common break)
 *   4. briefs generated, 0 sent   → error   (all filtered/suppressed/already-sent)
 *   5. no briefs + orgs skipped   → error   (every org failed generation)
 *   6. no briefs + no orgs        → warn    (nobody enrolled — worth knowing on send day)
 *   7. otherwise                  → ok
 *
 * Pure — no I/O. Exported for unit testing.
 */
export function evaluateDeliveryHealth(
  summary: SchedulerRunSummary,
  isSendDay: boolean
): DeliveryHealth {
  if (!isSendDay) {
    return { severity: "ok", reason: "", message: "off-day generation run — no email expected" };
  }

  if (summary.errors.some((e) => e.startsWith("orgs_query_failed"))) {
    return {
      severity: "error",
      reason: "orgs_query_failed",
      message: "Brief scheduler could not query active orgs — no briefs were sent."
    };
  }

  if (summary.emails_failed > 0) {
    return {
      severity: "error",
      reason: "send_failures",
      message:
        `Intelligence Brief delivery had ${summary.emails_failed} failed send(s) ` +
        `(${summary.emails_sent} sent). Check RESEND_API_KEY and that BRIEF_FROM_EMAIL is a verified Resend sender.`
    };
  }

  if (summary.briefs_generated > 0 && summary.emails_sent === 0) {
    return {
      severity: "error",
      reason: "generated_but_no_delivery",
      message:
        `Intelligence Brief generated ${summary.briefs_generated} brief(s) but delivered 0 emails ` +
        `(all subscribers filtered, suppressed, or already sent).`
    };
  }

  if (summary.briefs_generated === 0 && summary.orgs_skipped > 0) {
    return {
      severity: "error",
      reason: "all_generation_failed",
      message: `Intelligence Brief generation failed for all ${summary.orgs_skipped} org(s) — no email sent.`
    };
  }

  if (summary.briefs_generated === 0 && summary.orgs_processed === 0) {
    return {
      severity: "warn",
      reason: "no_active_subscribers",
      message: "Intelligence Brief send day, but no organization has active subscribers — nothing was sent."
    };
  }

  return {
    severity: "ok",
    reason: "",
    message: `Intelligence Brief delivered ${summary.emails_sent} email(s) across ${summary.orgs_processed} org(s).`
  };
}

/**
 * Evaluate the run and, when the verdict is not "ok", emit an operator alert
 * via the shared webhook. Best-effort: never throws, so it is safe to call at
 * every scheduler exit point.
 */
export async function maybeAlertBriefDelivery(
  summary: SchedulerRunSummary,
  isSendDay: boolean
): Promise<DeliveryHealth> {
  const health = evaluateDeliveryHealth(summary, isSendDay);

  if (health.severity === "ok") {
    return health;
  }

  logger.warn(
    {
      event: "brief_delivery_health",
      severity: health.severity,
      reason: health.reason,
      emails_sent: summary.emails_sent,
      emails_failed: summary.emails_failed,
      briefs_generated: summary.briefs_generated,
      orgs_processed: summary.orgs_processed,
      orgs_skipped: summary.orgs_skipped
    },
    `Intelligence Brief delivery health: ${health.severity} — ${health.reason}`
  );

  try {
    await sendFailureAlert(
      "intelligence-brief-delivery",
      `[${health.severity}] ${health.message}`
    );
  } catch (err) {
    logger.warn(
      { event: "brief_delivery_alert_failed", reason: health.reason, err },
      "Failed to send Intelligence Brief delivery-health alert (non-fatal)"
    );
  }

  return health;
}
