import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { sendWeeklySummary } from "./alertEmailService.js";

export async function runWeeklySummary(): Promise<{ orgsProcessed: number; emailsSent: number }> {
  logger.info({ event: "weekly_summary_start" }, "Weekly summary run started");

  const orgsResult = await pg.query<{ id: string; name: string }>(
    `SELECT id, name FROM organizations WHERE status = 'active'`
  );

  let orgsProcessed = 0;
  let emailsSent = 0;

  for (const org of orgsResult.rows) {
    try {
      const orgId = org.id;

      const [postureResult, findingsResult, frameworksResult] = await Promise.all([
        pg.query<{ posture_score: number }>(
          `SELECT posture_score FROM posture_snapshots
           WHERE organization_id = $1
           ORDER BY created_at DESC LIMIT 1`,
          [orgId]
        ),
        pg.query<{ open_count: string; critical_count: string }>(
          `SELECT
             COUNT(*) FILTER (WHERE status IN ('open', 'in_progress')) AS open_count,
             COUNT(*) FILTER (WHERE severity = 'Critical') AS critical_count
           FROM findings WHERE organization_id = $1`,
          [orgId]
        ),
        pg.query<{ name: string; satisfied: string; total: string }>(
          `SELECT
             f.name,
             COUNT(DISTINCT r.id) FILTER (
               WHERE EXISTS (
                 SELECT 1 FROM control_mappings cm
                 JOIN controls c ON c.id = cm.control_id
                 JOIN control_assessments ca ON ca.control_id = c.id
                 WHERE cm.requirement_id = r.id
                   AND ca.status = 'passed'
                   AND ca.id = (
                     SELECT ca2.id FROM control_assessments ca2
                     WHERE ca2.control_id = c.id
                     ORDER BY ca2.performed_at DESC NULLS LAST, ca2.created_at DESC
                     LIMIT 1
                   )
               )
             ) AS satisfied,
             COUNT(DISTINCT r.id) AS total
           FROM frameworks f
           JOIN requirements r ON r.framework_id = f.id
           WHERE f.organization_id = $1
           GROUP BY f.id, f.name
           HAVING COUNT(DISTINCT r.id) > 0
           ORDER BY
             (COUNT(DISTINCT r.id) FILTER (
               WHERE EXISTS (
                 SELECT 1 FROM control_mappings cm
                 JOIN controls c ON c.id = cm.control_id
                 JOIN control_assessments ca ON ca.control_id = c.id
                 WHERE cm.requirement_id = r.id AND ca.status = 'passed'
               )
             ))::float / NULLIF(COUNT(DISTINCT r.id), 0) ASC
           LIMIT 5`,
          [orgId]
        ),
      ]);

      const postureScore = postureResult.rows[0]?.posture_score ?? null;
      const openFindings = parseInt(findingsResult.rows[0]?.open_count ?? "0", 10);
      const criticalFindings = parseInt(findingsResult.rows[0]?.critical_count ?? "0", 10);
      const frameworkReadiness = frameworksResult.rows.map((r) => ({
        name: r.name,
        score: r.total === "0" ? 0 : Math.round((parseInt(r.satisfied, 10) / parseInt(r.total, 10)) * 100),
      }));

      const recipientsResult = await pg.query<{ user_id: string; email: string }>(
        `SELECT u.id AS user_id, u.email
         FROM users u
         LEFT JOIN user_alert_preferences uap ON uap.user_id = u.id
         WHERE u.organization_id = $1
           AND u.status = 'active'
           AND u.email_verified = TRUE
           AND COALESCE(uap.weekly_summary, TRUE) = TRUE`,
        [orgId]
      );

      for (const recipient of recipientsResult.rows) {
        await sendWeeklySummary({
          userId: recipient.user_id,
          email: recipient.email,
          organizationName: org.name,
          postureScore,
          openFindings,
          criticalFindings,
          frameworkReadiness,
        });
        emailsSent++;
      }

      orgsProcessed++;
    } catch (err) {
      logger.error({ event: "weekly_summary_org_failed", orgId: org.id, err }, "Weekly summary failed for org");
    }
  }

  logger.info({ event: "weekly_summary_complete", orgsProcessed, emailsSent }, "Weekly summary run complete");
  return { orgsProcessed, emailsSent };
}
