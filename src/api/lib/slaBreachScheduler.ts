/**
 * slaBreachScheduler.ts — the daily SLA-breach sweep (EG2 Tier 2 slice 11,
 * Intelligent Notifications).
 *
 * Findings and actions carry due dates, the workspace shows an SLA Breached
 * bucket, and overdue work is called out on every card — but a breach itself
 * notified NO ONE: work went overdue silently until someone happened to open
 * a queue. This sweep closes that gap with the platform's notification
 * discipline:
 *
 *   PRIORITIZED   only work that BECAME overdue recently — the query looks
 *                 back 7 days so a failed send, a missed cron tick, or an
 *                 overflowed email is caught up by a later sweep (the ledger
 *                 dedupe below keeps catch-up spam-free); standing breaches
 *                 older than the window were announced once and live in the
 *                 SLA bucket
 *   GROUPED       one email per OWNER per day listing their newly-breached
 *                 findings and actions together — never per-item spam
 *   ACTIONABLE    every item deep-links to the record (finding page, or the
 *                 parent finding for a remediation action)
 *   LOW-NOISE     per-(user, item, due-date) ledger dedupe — a due-date
 *                 extension that later re-breaches re-notifies, a repeat
 *                 sweep over the same breach never does; suppression list
 *                 honored; per-user opt-out (sla_breach_daily, default ON)
 *
 * Dark behind SECURELOGIC_SLA_ALERTS_ENABLED (default off; declared dark in
 * render.yaml — enabling is an operator action after a staging check, the
 * matcher-alerts pattern). Wired into the daily scheduler tick at 8:15 UTC,
 * after the 7:30 posture snapshot and alongside the 8:00 digest.
 */
import { pgElevated, withTenant, pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { sendViaProvider } from "../infra/emailTransport.js";
import {
  getResend,
  getFromAddress,
  getAppBaseUrl,
  htmlEscape,
  isSuppressed,
  isDuplicate,
  recordSend,
} from "./alerting/alertPrimitives.js";
import { sqlFindingActive, sqlActionActive } from "./metricDefinitions.js";

const ALERT_TYPE = "sla_breach_daily";
/** Cap per email — a mass-breach day must not produce a 400-row email. */
const MAX_ITEMS_PER_EMAIL = 20;

export function slaAlertsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_SLA_ALERTS_ENABLED"] === "true";
}

type BreachedItem = {
  kind: "finding" | "action";
  id: string;
  title: string;
  severity: string | null;
  due_date: string;
  owner_user_id: string;
  parent_finding_id: string | null;
};

export type SlaBreachSweepSummary = {
  orgsProcessed: number;
  emailsSent: number;
  itemsNotified: number;
  itemsDeduped: number;
};

export async function runDailySlaBreachSweep(): Promise<SlaBreachSweepSummary> {
  const summary: SlaBreachSweepSummary = {
    orgsProcessed: 0,
    emailsSent: 0,
    itemsNotified: 0,
    itemsDeduped: 0,
  };
  if (!slaAlertsEnabled()) return summary;

  const orgsResult = await pgElevated.query<{ id: string; name: string }>(
    `SELECT id, name FROM organizations WHERE status = 'active'`
  );

  for (const org of orgsResult.rows) {
    try {
      await withTenant(org.id, async () => {
        summary.orgsProcessed++;

        // Newly breached, OWNED work only: an unowned overdue item has no one
        // to notify (it is the Needs Assignment queue's problem, not email's).
        const items = await pg.query<BreachedItem>(
          `
          SELECT 'finding' AS kind, f.id, f.title, f.severity,
                 f.due_date::text AS due_date, f.owner_user_id,
                 NULL::text AS parent_finding_id
          FROM findings f
          WHERE f.organization_id = $1
            AND ${sqlFindingActive("f.operational_status")}
            AND f.owner_user_id IS NOT NULL
            AND f.due_date < CURRENT_DATE
            AND f.due_date >= CURRENT_DATE - 7

          UNION ALL

          SELECT 'action' AS kind, a.id, a.title, NULL AS severity,
                 a.due_date::text AS due_date, a.owner_user_id,
                 CASE WHEN a.source_type = 'finding' THEN a.source_id::text ELSE NULL END
          FROM actions a
          WHERE a.organization_id = $1
            AND ${sqlActionActive("a.status")}
            AND a.owner_user_id IS NOT NULL
            AND a.due_date < CURRENT_DATE
            AND a.due_date >= CURRENT_DATE - 7
          `,
          [org.id]
        );
        if (items.rows.length === 0) return;

        // Group per owner → one email per owner per sweep.
        const byOwner = new Map<string, BreachedItem[]>();
        for (const item of items.rows) {
          const list = byOwner.get(item.owner_user_id) ?? [];
          list.push(item);
          byOwner.set(item.owner_user_id, list);
        }

        for (const [ownerId, ownerItems] of byOwner) {
          const recipient = await pg.query<{ email: string }>(
            `SELECT u.email
             FROM users u
             LEFT JOIN user_alert_preferences uap ON uap.user_id = u.id
             WHERE u.id = $1
               AND u.organization_id = $2
               AND u.status = 'active'
               AND u.email_verified = TRUE
               AND COALESCE(uap.sla_breach_daily, TRUE) = TRUE`,
            [ownerId, org.id]
          );
          const row = recipient.rows[0];
          if (!row) continue;
          if (await isSuppressed(row.email)) continue;

          // Ledger-filter to items this owner has never been told about (keyed
          // on the due date so an extended-then-rebreached item re-notifies).
          const fresh: BreachedItem[] = [];
          for (const item of ownerItems) {
            const key = `${item.kind}:${item.id}:${item.due_date}`;
            if (await isDuplicate(ownerId, ALERT_TYPE, key)) {
              summary.itemsDeduped++;
            } else {
              fresh.push(item);
            }
          }
          if (fresh.length === 0) continue;

          const shown = fresh.slice(0, MAX_ITEMS_PER_EMAIL);
          const overflow = fresh.length - shown.length;

          try {
            const sendResult = await sendViaProvider({
              client: getResend(),
              purpose: "alert.sla_breach_daily",
              orgId: org.id,
              correlationId: ownerId,
              from: getFromAddress(),
              to: row.email,
              subject: `SLA breached: ${fresh.length} item${fresh.length !== 1 ? "s" : ""} you own went overdue`,
              html: renderSlaBreachEmail(org.name, shown, overflow)
            });
            // A rejection must not stamp the ledger — throw into the catch below.
            if (!sendResult.ok) throw new Error(sendResult.errorMessage);
            for (const item of shown) {
              await recordSend(ownerId, ALERT_TYPE, `${item.kind}:${item.id}:${item.due_date}`);
            }
            summary.emailsSent++;
            summary.itemsNotified += shown.length;
          } catch (err) {
            logger.warn(
              { event: "sla_breach_send_failed", orgId: org.id, userId: ownerId, err },
              "SLA breach email failed (non-fatal; ledger unstamped for retry)"
            );
          }
        }
      });
    } catch (err) {
      logger.warn(
        { event: "sla_breach_org_failed", orgId: org.id, err },
        "SLA breach sweep failed for org (non-fatal; continuing)"
      );
    }
  }

  logger.info(
    { event: "sla_breach_sweep_complete", ...summary },
    "Daily SLA-breach sweep completed"
  );
  return summary;
}

function itemHref(item: BreachedItem): string {
  if (item.kind === "finding") {
    return `${getAppBaseUrl()}/findings/${encodeURIComponent(item.id)}`;
  }
  return item.parent_finding_id
    ? `${getAppBaseUrl()}/findings/${encodeURIComponent(item.parent_finding_id)}`
    : `${getAppBaseUrl()}/actions?view=mine`;
}

function renderSlaBreachEmail(
  orgName: string,
  items: BreachedItem[],
  overflow: number
): string {
  const rows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #1e293b;">
            <a href="${itemHref(item)}" style="color:#f1f5f9;font-size:14px;font-weight:600;text-decoration:none;">${htmlEscape(item.title)}</a>
            <p style="margin:2px 0 0;font-size:12px;color:#64748b;">
              ${item.kind === "finding" ? "Finding" : "Remediation action"}${item.severity ? ` · ${htmlEscape(item.severity)}` : ""} · was due ${htmlEscape(item.due_date)}
            </p>
          </td>
        </tr>`
    )
    .join("");

  const overflowRow =
    overflow > 0
      ? `<p style="margin:12px 0 0;font-size:12px;color:#64748b;">…and ${overflow} more in <a href="${getAppBaseUrl()}/findings?bucket=sla_breached" style="color:#00c4b4;">your SLA queue</a>.</p>`
      : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>SLA breached</title></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:12px;overflow:hidden;">
        <tr><td style="background:#f97316;padding:4px 0;"></td></tr>
        <tr>
          <td style="padding:32px 36px;">
            <p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:0.08em;color:#64748b;text-transform:uppercase;">SecureLogic AI · SLA</p>
            <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#f1f5f9;">Work you own went overdue</h1>
            <p style="margin:0 0 20px;font-size:13px;color:#94a3b8;">${htmlEscape(orgName)} — these items recently passed their due date. Unaddressed breaches age into the SLA queue and count against posture.</p>
            <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
            ${overflowRow}
            <p style="margin:24px 0 0;font-size:11px;color:#334155;">You received this because SLA alerts are enabled in your <a href="${getAppBaseUrl()}/account/alerts" style="color:#00c4b4;text-decoration:none;">alert preferences</a>.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
