import { withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { sendCriticalFindingAlert } from "./alertEmailService.js";
import { selectAlertRecipients } from "./alerting/alertRecipients.js";

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
  // open inside the tenant transaction. Recipient selection is the shared
  // selectAlertRecipients (extracted verbatim — same query, same tenant scope).
  await withTenant(organizationId, async () => {
    const rows = await selectAlertRecipients(organizationId, prefCol);

    for (const row of rows) {
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
