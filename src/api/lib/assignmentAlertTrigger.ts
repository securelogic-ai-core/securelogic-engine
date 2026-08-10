/**
 * assignmentAlertTrigger.ts — "you were assigned this" notification
 * (EG2 Tier 2 slice 7, Intelligent Notifications).
 *
 * Findings and actions gained owners, due dates, and a My Work queue long
 * before anything TOLD the owner — assignment was a silent row update and
 * My Work was a queue nobody knew to check. This trigger closes that gap
 * with the platform's alert discipline:
 *
 *   ACTIONABLE   one recipient (the new owner), deep link to the exact record
 *   NEVER NOISY  self-assignment never notifies; the alert_sends ledger
 *                dedupes per (user, kind:id) so re-saving the same owner —
 *                or an A→B→A reassignment — cannot re-email; suppression
 *                list honored; per-user opt-out (assignment_immediate,
 *                default ON like every other alert preference)
 *   FIRE-AND-FORGET  never blocks or fails the mutation that assigned the
 *                work; called AFTER the assigning transaction commits
 *                (setImmediate + own withTenant scope — A04-G1 γ.3, same
 *                pattern as the vendor-score recompute scheduler)
 */
import { withTenant, pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { withEnvironmentTag } from "../infra/emailEnvironment.js";
import {
  getResend,
  getFromAddress,
  getAppBaseUrl,
  htmlEscape,
  isSuppressed,
  isDuplicate,
  recordSend,
} from "./alerting/alertPrimitives.js";

export type AssignmentAlertInput = {
  organizationId: string;
  /** The user who now owns the work. */
  assigneeUserId: string;
  /** The user who did the assigning (null for API-key actors). Self-assignment never notifies. */
  actorUserId: string | null;
  item: {
    kind: "finding" | "action";
    id: string;
    title: string;
    severity?: string | null;
    dueDate?: string | null;
    /** For actions born from a finding — the deep link lands on the parent finding, where the action is worked. */
    parentFindingId?: string | null;
  };
};

const ALERT_TYPE = "assignment_immediate";

/** Fire-and-forget entry point. Safe to call from any route post-commit. */
export function triggerAssignmentAlert(input: AssignmentAlertInput): void {
  if (input.actorUserId !== null && input.actorUserId === input.assigneeUserId) return;

  setImmediate(() => {
    void withTenant(input.organizationId, () => doTrigger(input)).catch((err) => {
      logger.warn(
        { event: "assignment_alert_trigger_failed", err },
        "Assignment alert trigger failed (non-fatal)"
      );
    });
  });
}

async function doTrigger(input: AssignmentAlertInput): Promise<void> {
  const { organizationId, assigneeUserId, item } = input;

  // Assignee eligibility mirrors selectAlertRecipients: active, verified,
  // preference on (default ON when no row exists) — but for exactly one user.
  const recipient = await pg.query<{ email: string; organization_name: string }>(
    `SELECT u.email, o.name AS organization_name
     FROM users u
     JOIN organizations o ON o.id = u.organization_id
     LEFT JOIN user_alert_preferences uap ON uap.user_id = u.id
     WHERE u.id = $1
       AND u.organization_id = $2
       AND u.status = 'active'
       AND u.email_verified = TRUE
       AND COALESCE(uap.assignment_immediate, TRUE) = TRUE`,
    [assigneeUserId, organizationId]
  );
  const row = recipient.rows[0];
  if (!row) return;

  if (await isSuppressed(row.email)) return;

  const dedupeKey = `${item.kind}:${item.id}`;
  if (await isDuplicate(assigneeUserId, ALERT_TYPE, dedupeKey)) return;

  const targetUrl =
    item.kind === "finding"
      ? `${getAppBaseUrl()}/findings/${encodeURIComponent(item.id)}`
      : item.parentFindingId
        ? `${getAppBaseUrl()}/findings/${encodeURIComponent(item.parentFindingId)}`
        : `${getAppBaseUrl()}/actions?view=mine`;

  const kindLabel = item.kind === "finding" ? "Finding" : "Remediation action";
  const dueLine = item.dueDate
    ? `<p style="margin:0;font-size:12px;color:#64748b;">Due ${htmlEscape(String(item.dueDate).slice(0, 10))}</p>`
    : "";
  const severityLabel = item.severity ? ` · ${htmlEscape(item.severity)}` : "";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Assigned to you</title></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="background:#00c4b4;padding:4px 0;"></td>
        </tr>
        <tr>
          <td style="padding:32px 36px;">
            <p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:0.08em;color:#64748b;text-transform:uppercase;">SecureLogic AI · Assignment</p>
            <h1 style="margin:0 0 24px;font-size:20px;font-weight:700;color:#f1f5f9;">${kindLabel} assigned to you</h1>
            <div style="background:#0f172a;border-radius:8px;padding:20px;margin-bottom:24px;border-left:3px solid #00c4b4;">
              <p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#f1f5f9;">${htmlEscape(item.title)}</p>
              <p style="margin:0 0 4px;font-size:12px;color:#64748b;">${htmlEscape(row.organization_name)}${severityLabel}</p>
              ${dueLine}
            </div>
            <a href="${targetUrl}" style="display:inline-block;background:#00c4b4;color:#0f172a;font-size:13px;font-weight:600;padding:10px 20px;border-radius:8px;text-decoration:none;">Open your work →</a>
            <p style="margin:24px 0 0;font-size:11px;color:#334155;">You received this because assignment alerts are enabled in your <a href="${getAppBaseUrl()}/account/alerts" style="color:#00c4b4;text-decoration:none;">alert preferences</a>.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await getResend().emails.send({
      from: getFromAddress(),
      to: row.email,
      subject: `Assigned to you: ${item.title}`,
      html,
      tags: withEnvironmentTag(),
    });
    await recordSend(assigneeUserId, ALERT_TYPE, dedupeKey);
    logger.info(
      { event: "alert_sent", alertType: ALERT_TYPE, userId: assigneeUserId, itemKind: item.kind, itemId: item.id },
      "Assignment alert sent"
    );
  } catch (err) {
    logger.warn(
      { event: "alert_send_failed", alertType: ALERT_TYPE, userId: assigneeUserId, err },
      "Assignment alert send failed"
    );
  }
}
