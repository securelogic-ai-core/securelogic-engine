import { pg, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { sendCriticalFindingAlert } from "./alertEmailService.js";

type FindingAlertInput = {
  findingId: string;
  organizationId: string;
  title: string;
  severity: string;
  domain: string | null;
};

export function triggerFindingAlert(input: FindingAlertInput): void {
  const { severity } = input;
  if (severity !== "Critical" && severity !== "High") return;

  doTrigger(input).catch((err) => {
    logger.warn({ event: "finding_alert_trigger_failed", err }, "Finding alert trigger failed (non-fatal)");
  });
}

async function doTrigger(input: FindingAlertInput): Promise<void> {
  const { findingId, organizationId, title, severity, domain } = input;

  const prefCol = severity === "Critical" ? "critical_finding_immediate" : "high_finding_immediate";

  // RLS adoption (A04-G1 gap C'): scope the recipient query to the org so it
  // routes through the tenant client after the app_request flip. The per-
  // recipient sends are fire-and-forget (not awaited), so no email I/O is held
  // open inside the tenant transaction.
  await withTenant(organizationId, async () => {
    const result = await pg.query<{ user_id: string; email: string; organization_name: string }>(
      `SELECT
         u.id AS user_id,
         u.email,
         o.name AS organization_name
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       LEFT JOIN user_alert_preferences uap ON uap.user_id = u.id
       WHERE u.organization_id = $1
         AND u.status = 'active'
         AND u.email_verified = TRUE
         AND COALESCE(uap.${prefCol}, TRUE) = TRUE`,
      [organizationId]
    );

    for (const row of result.rows) {
      sendCriticalFindingAlert({
        userId: row.user_id,
        email: row.email,
        findingId,
        findingTitle: title,
        severity,
        domain,
        organizationName: row.organization_name,
      }).catch((err) => {
        logger.warn({ event: "finding_alert_send_failed", userId: row.user_id, err }, "Finding alert send failed");
      });
    }
  });
}
