/**
 * alertRecipients.ts — shared recipient selection for the alerting layer.
 *
 * Extracted verbatim from findingAlertTrigger.doTrigger so the per-finding
 * sender and the coalescing alert service select recipients identically:
 * active, email-verified users in the org whose relevant alert preference is on
 * (defaulting ON when no preference row exists).
 *
 * The caller is responsible for the tenant scope (withTenant) — this function
 * uses the ambient `pg` client so it runs inside the caller's tenant context,
 * exactly as the inline query did.
 */
import { pg } from "../../infra/postgres.js";

export type AlertRecipient = {
  user_id: string;
  email: string;
  organization_name: string;
};

/**
 * Allowlist of preference columns. The column name is interpolated into the SQL,
 * so it MUST be a fixed identifier — never a caller-supplied free string.
 */
const ALLOWED_PREF_COLUMNS = new Set([
  "critical_finding_immediate",
  "high_finding_immediate",
  "daily_digest",
]);

/**
 * Select eligible recipients for an org-scoped alert.
 *
 * @param organizationId  org to scope to (also enforced by the caller's tenant context)
 * @param prefColumn      a user_alert_preferences boolean column from the allowlist;
 *                        recipients with NULL/absent preference default to opted-in
 */
export async function selectAlertRecipients(
  organizationId: string,
  prefColumn: string
): Promise<AlertRecipient[]> {
  if (!ALLOWED_PREF_COLUMNS.has(prefColumn)) {
    throw new Error(`selectAlertRecipients: unknown preference column "${prefColumn}"`);
  }

  const result = await pg.query<AlertRecipient>(
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
       AND COALESCE(uap.${prefColumn}, TRUE) = TRUE`,
    [organizationId]
  );

  return result.rows;
}
