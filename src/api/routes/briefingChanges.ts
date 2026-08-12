/**
 * briefingChanges.ts — GET /api/briefing/changes (EG2 Tier 2 slice 10,
 * Operational Presence).
 *
 * The compact "since your last visit" delta behind The Briefing's opening
 * module. The Briefing greeted every returning user with the same static
 * modules; previousLoginAt existed (LastLoginBanner) but nothing diffed
 * against it, so the morning question — "what changed overnight?" — was
 * answered by re-scanning every surface.
 *
 * One round trip, five facts, all org-scoped:
 *   worse:    new active findings (and how many Critical/High) since `since`;
 *             actions that BECAME overdue since `since`
 *   decision: findings whose remediation completed since `since`
 *             (operational→remediated lifecycle events — the ready-to-close feed)
 *   better:   findings resolved since `since` (decision→resolved events)
 *   intel:    a brief published since `since`
 *
 * Dark behind SECURELOGIC_DASHBOARD_BRIEFING_ENABLED (engine half of the
 * Briefing two-switch), same chain as the layout routes. `since` is clamped
 * to the last 90 days — a multi-year-stale login must not scan unbounded
 * history; the clamp is reported so the UI can say "in the last 90 days".
 */
import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { asTenant } from "../middleware/asTenant.js";
import { sqlFindingActive, sqlActionActive } from "../lib/metricDefinitions.js";

const router = Router();

const MAX_WINDOW_DAYS = 90;

function briefingDisabled(): boolean {
  return process.env.SECURELOGIC_DASHBOARD_BRIEFING_ENABLED !== "true";
}

router.get(
  "/briefing/changes",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(async (req, res) => {
    if (briefingDisabled()) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const organizationId =
      (req as any).organizationContext?.organizationId ?? null;
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const sinceRaw = String(req.query["since"] ?? "").trim();
    const sinceMs = Date.parse(sinceRaw);
    if (!sinceRaw || Number.isNaN(sinceMs)) {
      res.status(400).json({ error: "since_must_be_iso_timestamp" });
      return;
    }
    if (sinceMs > Date.now()) {
      res.status(400).json({ error: "since_must_be_in_the_past" });
      return;
    }

    const floorMs = Date.now() - MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const clamped = sinceMs < floorMs;
    const since = new Date(clamped ? floorMs : sinceMs).toISOString();

    try {
      const result = await pg.query<{
        new_active_findings: string;
        new_critical_high: string;
        remediation_completed: string;
        resolved: string;
        newly_overdue_actions: string;
        briefs_published: string;
      }>(
        `
        SELECT
          (SELECT COUNT(*) FROM findings
            WHERE organization_id = $1 AND created_at > $2
              AND ${sqlFindingActive()})                                        AS new_active_findings,
          (SELECT COUNT(*) FROM findings
            WHERE organization_id = $1 AND created_at > $2
              AND ${sqlFindingActive()}
              AND severity IN ('Critical','High'))                              AS new_critical_high,
          -- Transitions come from the append-only lifecycle stream: what
          -- ENTERED remediated / resolved during the window, deduped per
          -- finding (a recompute can re-emit the same to_state).
          (SELECT COUNT(DISTINCT finding_id) FROM finding_lifecycle_events
            WHERE organization_id = $1 AND created_at > $2
              AND axis = 'operational' AND to_state = 'remediated')             AS remediation_completed,
          (SELECT COUNT(DISTINCT finding_id) FROM finding_lifecycle_events
            WHERE organization_id = $1 AND created_at > $2
              AND axis = 'decision' AND to_state = 'resolved')                  AS resolved,
          -- Became overdue during the window: still-active work whose due date
          -- fell inside it. (Work already overdue before the window is the
          -- standing SLA-breached bucket, not "new since your last visit".)
          (SELECT COUNT(*) FROM actions
            WHERE organization_id = $1
              AND ${sqlActionActive()}
              AND due_date < CURRENT_DATE
              AND due_date >= $2::date)                                         AS newly_overdue_actions,
          (SELECT COUNT(*) FROM intelligence_briefs
            WHERE organization_id = $1 AND status = 'published'
              AND published_at > $2)                                            AS briefs_published
        `,
        [organizationId, since]
      );

      const row = result.rows[0]!;
      res.status(200).json({
        since,
        clamped,
        window_days_max: MAX_WINDOW_DAYS,
        changes: {
          new_active_findings: parseInt(row.new_active_findings, 10),
          new_critical_high: parseInt(row.new_critical_high, 10),
          remediation_completed: parseInt(row.remediation_completed, 10),
          resolved: parseInt(row.resolved, 10),
          newly_overdue_actions: parseInt(row.newly_overdue_actions, 10),
          briefs_published: parseInt(row.briefs_published, 10),
        },
      });
    } catch (err) {
      logger.error(
        { event: "briefing_changes_failed", organizationId, err },
        "GET /api/briefing/changes failed"
      );
      res.status(500).json({ error: "briefing_changes_failed" });
    }
  })
);

export default router;
