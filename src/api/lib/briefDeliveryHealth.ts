/**
 * briefDeliveryHealth.ts — turns a silent Intelligence Brief no-op into a loud
 * operator signal.
 *
 * The weekly Brief scheduler (briefScheduler.runScheduler) can complete
 * "successfully" while generating or delivering nothing — every org failing
 * generation, every Resend call failing (e.g. an unverified sender domain), or
 * every recipient filtered out. Before this module those outcomes were only
 * info/error log lines; nothing paged an operator, so a broken week could pass
 * unnoticed.
 *
 * Under the ratified product model (ADR-0007), brief GENERATION is an
 * organizational entitlement — every active org gets a brief — and email
 * delivery is a separate capability resolved from subscriber records. That
 * split shapes the verdicts:
 *
 *   - zero briefs generated while active orgs exist  → ERROR (operational
 *     failure of the platform's core briefing promise)
 *   - zero recipients for some or all orgs           → WARN  (delivery-health
 *     condition: the in-platform brief is current; only email is uncovered)
 *
 * evaluateDeliveryHealth() is a PURE function of the run summary + whether the
 * run was on the weekly send day. It classifies the run as ok / warn / error
 * with a stable machine reason. maybeAlertBriefDelivery() wires that verdict to
 * the existing operator webhook (sendFailureAlert), best-effort: a webhook that
 * is unset is a no-op, and an alert that throws never breaks the scheduler run.
 *
 * Scope discipline: this only OBSERVES. It never changes what is generated or
 * sent.
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

/** How many uncovered org ids to name in an alert before truncating. */
const MAX_ORGS_IN_MESSAGE = 5;

function formatOrgList(orgIds: string[]): string {
  const shown = orgIds.slice(0, MAX_ORGS_IN_MESSAGE).join(", ");
  const overflow = orgIds.length - MAX_ORGS_IN_MESSAGE;
  return overflow > 0 ? `${shown} (+${overflow} more)` : shown;
}

/**
 * Classify a scheduler run's outcome.
 *
 * Precedence (first match wins):
 *   1. orgs query failed                      → error (could not enumerate active orgs)
 *   2. active orgs exist, 0 briefs generated  → error (operational failure — applies
 *                                                even on off-day runs, which still generate)
 *   3. non-send-day                           → ok    (generation succeeded; no email expected)
 *   4. emails_failed > 0                      → error (Resend/env problem — the common break)
 *   5. briefs generated, 0 sent:
 *        all skips are zero-recipient orgs    → warn  (no_recipients_configured — email
 *                                                uncovered everywhere; in-platform briefs current)
 *        otherwise                            → error (generated_but_no_delivery — recipients
 *                                                existed but all were filtered/suppressed/already-sent)
 *   6. no active orgs at all                  → warn  (empty platform — worth knowing on send day)
 *   7. some orgs have zero recipients         → warn  (orgs_without_recipients — the recurring
 *                                                delivery-coverage report)
 *   8. otherwise                              → ok
 *
 * Pure — no I/O. Exported for unit testing.
 */
export function evaluateDeliveryHealth(
  summary: SchedulerRunSummary,
  isSendDay: boolean
): DeliveryHealth {
  if (summary.errors.some((e) => e.startsWith("orgs_query_failed"))) {
    return {
      severity: "error",
      reason: "orgs_query_failed",
      message: "Brief scheduler could not enumerate active organizations — no briefs were generated."
    };
  }

  if (summary.active_orgs > 0 && summary.briefs_generated === 0) {
    if (summary.orgs_skipped > 0) {
      return {
        severity: "error",
        reason: "all_generation_failed",
        message: `Intelligence Brief generation failed for all ${summary.orgs_skipped} active org(s) — active customers have no current brief.`
      };
    }
    return {
      severity: "error",
      reason: "no_briefs_generated",
      message: `Intelligence Brief run produced 0 briefs while ${summary.active_orgs} organization(s) are active — generation is an entitlement of every active org; treat as an operational failure.`
    };
  }

  if (!isSendDay) {
    return { severity: "ok", reason: "", message: "off-day generation run — no email expected" };
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
    if (summary.emails_skipped_no_recipients >= summary.briefs_generated) {
      return {
        severity: "warn",
        reason: "no_recipients_configured",
        message:
          `Intelligence Brief generated ${summary.briefs_generated} brief(s); no org has active email recipients, so 0 emails were sent. ` +
          `In-platform briefs are current — configure recipients to enable email delivery.`
      };
    }
    return {
      severity: "error",
      reason: "generated_but_no_delivery",
      message:
        `Intelligence Brief generated ${summary.briefs_generated} brief(s) but delivered 0 emails ` +
        `(all subscribers filtered, suppressed, or already sent).`
    };
  }

  if (summary.active_orgs === 0) {
    return {
      severity: "warn",
      reason: "no_active_orgs",
      message: "Intelligence Brief send day, but no organization is active — nothing to generate or send."
    };
  }

  if (summary.orgs_without_recipients.length > 0) {
    return {
      severity: "warn",
      reason: "orgs_without_recipients",
      message:
        `Intelligence Brief delivered ${summary.emails_sent} email(s), but ${summary.orgs_without_recipients.length} active org(s) ` +
        `have no email recipients and received in-platform briefs only: ${formatOrgList(summary.orgs_without_recipients)}.`
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
      active_orgs: summary.active_orgs,
      emails_sent: summary.emails_sent,
      emails_failed: summary.emails_failed,
      emails_skipped_no_recipients: summary.emails_skipped_no_recipients,
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
