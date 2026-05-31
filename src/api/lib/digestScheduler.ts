import { pg, pgElevated, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { sendDailyDigest } from "./alertEmailService.js";

export async function runDailyDigest(): Promise<{ orgsProcessed: number; emailsSent: number }> {
  logger.info({ event: "daily_digest_start" }, "Daily digest run started");

  const orgsResult = await pgElevated.query<{ organization_id: string; organization_name: string }>(
    `SELECT DISTINCT f.organization_id, o.name AS organization_name
     FROM findings f
     JOIN organizations o ON o.id = f.organization_id
     WHERE f.created_at >= NOW() - INTERVAL '24 hours'`
  );

  let orgsProcessed = 0;
  let emailsSent = 0;

  for (const org of orgsResult.rows) {
    await withTenant(org.organization_id, async () => {
      try {
        const { organization_id: orgId, organization_name: orgName } = org;

        const [newFindingsResult, allOpenResult] = await Promise.all([
          pg.query<{ id: string; title: string; severity: string; domain: string | null }>(
            `SELECT id, title, severity, domain FROM findings
             WHERE organization_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'
             ORDER BY
               CASE severity WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Moderate' THEN 3 ELSE 4 END,
               created_at DESC`,
            [orgId]
          ),
          pg.query<{ open_count: string; critical_count: string }>(
            `SELECT
               COUNT(*) FILTER (WHERE status = 'open' OR status = 'in_progress') AS open_count,
               COUNT(*) FILTER (WHERE severity = 'Critical') AS critical_count
             FROM findings WHERE organization_id = $1`,
            [orgId]
          ),
        ]);

        const newFindings = newFindingsResult.rows;
        if (newFindings.length === 0) return;

        const openCount = parseInt(allOpenResult.rows[0]?.open_count ?? "0", 10);
        const criticalCount = parseInt(allOpenResult.rows[0]?.critical_count ?? "0", 10);

        const recipientsResult = await pg.query<{ user_id: string; email: string }>(
          `SELECT u.id AS user_id, u.email
           FROM users u
           LEFT JOIN user_alert_preferences uap ON uap.user_id = u.id
           WHERE u.organization_id = $1
             AND u.status = 'active'
             AND u.email_verified = TRUE
             AND COALESCE(uap.daily_digest, TRUE) = TRUE`,
          [orgId]
        );

        for (const recipient of recipientsResult.rows) {
          await sendDailyDigest({
            userId: recipient.user_id,
            email: recipient.email,
            organizationName: orgName,
            newFindings,
            openCount,
            criticalCount,
          });
          emailsSent++;
        }

        orgsProcessed++;
      } catch (err) {
        logger.error({ event: "daily_digest_org_failed", orgId: org.organization_id, err }, "Daily digest failed for org");
      }
    });
  }

  logger.info({ event: "daily_digest_complete", orgsProcessed, emailsSent }, "Daily digest run complete");
  return { orgsProcessed, emailsSent };
}
