/**
 * alertService.ts — shared coalescing alert service.
 *
 * Producers (the matcher fan-out today; staleness / action-engine later) create
 * a batcher for one cycle, add() items as conditions are detected, then flush()
 * ONCE at the end of the cycle. The service owns: select recipients → apply the
 * volume policy (coalesce: one email per org per cycle) → send → record ledger.
 *
 * Reuses the shared primitives (recipient selection, suppression, ledger,
 * transport) — see alertRecipients.ts / alertPrimitives.ts.
 *
 * VOLUME POLICY: one email per (org, recipient) per flush. The flush is the
 * cycle boundary; a guard prevents double-flush.
 *
 * IDEMPOTENCY: the ledger is keyed per (user, finding). Items already alerted to
 * a recipient are dropped before send, so a duplicate finding row (the matcher
 * INSERT has no ON CONFLICT) can never produce a second alert to the same user.
 *
 * TENANT SCOPE: recipient SELECTs run inside withTenant(orgId) (like doTrigger).
 * Suppression/ledger/send happen OUTSIDE the tenant transaction so no email I/O
 * is held open on the tenant connection.
 */
import { withTenant } from "../../infra/postgres.js";
import { logger } from "../../infra/logger.js";
import { selectAlertRecipients, type AlertRecipient } from "./alertRecipients.js";
import {
  isSuppressed,
  isDuplicate,
  recordSend,
  getResend,
  getFromAddress,
} from "./alertPrimitives.js";
import { renderCriticalBatchEmail } from "./criticalBatchEmail.js";

export type AlertSeverity = "Critical" | "High";
export type AlertKind = "critical_finding";

export type AlertItem = {
  findingId: string;
  title: string;
  severity: AlertSeverity;
  domain: string | null;
};

export type AlertFlushResult = {
  orgsProcessed: number;
  emailsSent: number;
  recipientsSuppressed: number;
  itemsAdded: number;
  orgsSkippedNoRecipients: number;
};

export interface AlertBatcher {
  add(orgId: string, item: AlertItem): void;
  size(): number;
  flush(): Promise<AlertFlushResult>;
}

type KindConfig = {
  /** ledger alert_type — distinct from the per-finding path's "critical_finding_immediate". */
  alertType: string;
  /** the user_alert_preferences column gating each severity. */
  prefColumnFor: Record<AlertSeverity, string>;
  render: (orgName: string, items: AlertItem[]) => { subject: string; html: string };
};

const KIND_CONFIG: Record<AlertKind, KindConfig> = {
  critical_finding: {
    alertType: "critical_finding_batch",
    prefColumnFor: {
      Critical: "critical_finding_immediate",
      High: "high_finding_immediate",
    },
    render: renderCriticalBatchEmail,
  },
};

const EMPTY_RESULT: AlertFlushResult = {
  orgsProcessed: 0,
  emailsSent: 0,
  recipientsSuppressed: 0,
  itemsAdded: 0,
  orgsSkippedNoRecipients: 0,
};

/**
 * Create a per-cycle alert batcher.
 * @param kind     alert kind (selects pref columns + renderer + ledger type)
 * @param cycleId  free-form label for logs (e.g. "pipeline" / "kev")
 */
export function createAlertBatcher(
  kind: AlertKind = "critical_finding",
  cycleId = "cycle"
): AlertBatcher {
  const config = KIND_CONFIG[kind];
  const batch = new Map<string, AlertItem[]>();
  let itemsAdded = 0;
  let flushed = false;

  function add(orgId: string, item: AlertItem): void {
    const list = batch.get(orgId);
    if (list) list.push(item);
    else batch.set(orgId, [item]);
    itemsAdded++;
  }

  function size(): number {
    return itemsAdded;
  }

  async function flush(): Promise<AlertFlushResult> {
    if (flushed) {
      logger.warn(
        { event: "alert_batch_double_flush", kind, cycleId },
        "Alert batcher flush() called more than once — ignoring"
      );
      return { ...EMPTY_RESULT };
    }
    flushed = true;

    const result: AlertFlushResult = { ...EMPTY_RESULT, itemsAdded };

    // No early return on an empty batch. The for-loop below is a no-op when the
    // batch is empty, so execution falls through to the single
    // alert_batch_flush_complete log at the end — making that line a per-cycle
    // HEARTBEAT. Every flag-on cycle emits it (itemsAdded:0 / emailsSent:0 when
    // there was nothing to alert), so "working, nothing to alert" is
    // distinguishable from "silently broken" (no log at all) in prod.
    for (const [orgId, items] of batch) {
      // 1. Recipient selection (tenant-scoped read only — no email I/O here).
      const severities = [...new Set(items.map((i) => i.severity))];
      const recipientsBySeverity = new Map<AlertSeverity, AlertRecipient[]>();
      try {
        await withTenant(orgId, async () => {
          for (const sev of severities) {
            recipientsBySeverity.set(
              sev,
              await selectAlertRecipients(orgId, config.prefColumnFor[sev])
            );
          }
        });
      } catch (err) {
        logger.warn(
          { event: "alert_batch_recipients_failed", kind, orgId, err },
          "Alert batch: recipient selection failed for org; skipping"
        );
        continue;
      }

      // Build per-recipient eligible items: a recipient gets only items whose
      // severity they're opted into.
      const byUser = new Map<
        string,
        { recipient: AlertRecipient; items: AlertItem[] }
      >();
      for (const sev of severities) {
        for (const r of recipientsBySeverity.get(sev) ?? []) {
          const entry = byUser.get(r.user_id) ?? { recipient: r, items: [] };
          for (const item of items) if (item.severity === sev) entry.items.push(item);
          byUser.set(r.user_id, entry);
        }
      }

      if (byUser.size === 0) {
        result.orgsSkippedNoRecipients++;
        continue;
      }
      result.orgsProcessed++;

      // 2. Suppression + ledger dedup + send (outside the tenant transaction).
      for (const { recipient, items: eligible } of byUser.values()) {
        try {
          if (await isSuppressed(recipient.email)) {
            result.recipientsSuppressed++;
            continue;
          }

          const fresh: AlertItem[] = [];
          for (const item of eligible) {
            const dup = await isDuplicate(
              recipient.user_id,
              config.alertType,
              `finding:${item.findingId}`
            );
            if (!dup) fresh.push(item);
          }
          if (fresh.length === 0) continue;

          const { subject, html } = config.render(recipient.organization_name, fresh);
          await getResend().emails.send({
            from: getFromAddress(),
            to: recipient.email,
            subject,
            html,
          });

          for (const item of fresh) {
            await recordSend(
              recipient.user_id,
              config.alertType,
              `finding:${item.findingId}`
            );
          }

          result.emailsSent++;
          logger.info(
            {
              event: "alert_sent",
              alertType: config.alertType,
              userId: recipient.user_id,
              orgId,
              count: fresh.length,
            },
            "Coalesced critical-finding alert sent"
          );
        } catch (err) {
          logger.warn(
            {
              event: "alert_send_failed",
              alertType: config.alertType,
              userId: recipient.user_id,
              orgId,
              err,
            },
            "Coalesced critical-finding alert failed"
          );
        }
      }
    }

    logger.info(
      {
        event: "alert_batch_flush_complete",
        kind,
        cycleId,
        ...result,
      },
      `Alert batch flush complete — ${result.emailsSent} emails across ${result.orgsProcessed} orgs`
    );
    return result;
  }

  return { add, size, flush };
}
