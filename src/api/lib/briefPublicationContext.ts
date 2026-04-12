/**
 * briefPublicationContext.ts
 *
 * Captures a point-in-time snapshot of the organization's platform posture state
 * for storage on a newsletter_issue at publication time (status → 'sent').
 *
 * The result is stored as publication_context_json on newsletter_issues. It is
 * read once at publish and never recomputed — the Brief preserves the state of
 * the platform as it was when the issue went out.
 *
 * Returns null when:
 *   - orgId is null (platform-wide brief has no org context to snapshot)
 *   - no posture_snapshot row exists for the org (no snapshot yet)
 *   - any query throws (capture failure must not block publication; logged, returns null)
 */

import type { Pool } from "pg";
import { logger } from "../infra/logger.js";

export type PublicationContextDomain = {
  domain: string;
  score: number | null;
  severity: string | null;
  finding_count: number;
  action_count: number;
};

export type PublicationContextJson = {
  captured_at: string;
  posture_snapshot_id: string;
  overall_score: number | null;
  overall_severity: string | null;
  snapshot_date: string | null;
  domains: PublicationContextDomain[];
  findings: {
    open: number;
    by_severity: {
      Critical: number;
      High: number;
      Moderate: number;
      Low: number;
    };
  };
  actions: {
    open: number;
    overdue: number;
  };
};

/**
 * Builds the by_severity map from aggregate rows.
 * Always returns all four canonical severity keys; missing severities default to 0.
 */
function buildBySeverity(
  rows: ReadonlyArray<{ severity: string; count: string }>
): { by_severity: PublicationContextJson["findings"]["by_severity"]; open: number } {
  const by_severity: PublicationContextJson["findings"]["by_severity"] = {
    Critical: 0,
    High: 0,
    Moderate: 0,
    Low: 0,
  };
  let open = 0;
  for (const row of rows) {
    const n = parseInt(row.count, 10);
    if (row.severity in by_severity) {
      (by_severity as Record<string, number>)[row.severity] = n;
    }
    open += n;
  }
  return { by_severity, open };
}

export async function capturePublicationContext(
  orgId: string,
  pg: Pool
): Promise<PublicationContextJson | null> {
  try {
    // 1. Most recent posture snapshot for the org
    const snapshotResult = await pg.query<{
      id: string;
      overall_score: number | null;
      overall_severity: string | null;
      snapshot_date: string | null;
    }>(
      `
      SELECT id, overall_score, overall_severity, snapshot_date
      FROM posture_snapshots
      WHERE organization_id = $1
      ORDER BY snapshot_date DESC
      LIMIT 1
      `,
      [orgId]
    );

    if ((snapshotResult.rowCount ?? 0) === 0) {
      return null;
    }

    const snapshot = snapshotResult.rows[0]!;

    // 2. Domain scores for that snapshot
    const domainResult = await pg.query<{
      domain: string;
      score: number | null;
      severity: string | null;
      finding_count: number;
      action_count: number;
    }>(
      `
      SELECT domain, score, severity, finding_count, action_count
      FROM domain_scores
      WHERE posture_snapshot_id = $1
      ORDER BY
        CASE severity
          WHEN 'Critical' THEN 1
          WHEN 'High'     THEN 2
          WHEN 'Moderate' THEN 3
          WHEN 'Low'      THEN 4
          ELSE 5
        END,
        domain ASC
      `,
      [snapshot.id]
    );

    // 3. Open findings by severity
    const findingResult = await pg.query<{ severity: string; count: string }>(
      `
      SELECT severity, COUNT(*)::text AS count
      FROM findings
      WHERE organization_id = $1
        AND status = 'open'
      GROUP BY severity
      `,
      [orgId]
    );

    const { by_severity, open: totalOpen } = buildBySeverity(findingResult.rows);

    // 4. Open and overdue action counts
    const actionResult = await pg.query<{
      open_count: string;
      overdue_count: string;
    }>(
      `
      SELECT
        COUNT(*)::text AS open_count,
        COUNT(*) FILTER (
          WHERE due_date < CURRENT_DATE
            AND status NOT IN ('closed', 'accepted')
        )::text AS overdue_count
      FROM actions
      WHERE organization_id = $1
        AND status NOT IN ('closed', 'accepted')
      `,
      [orgId]
    );

    const actionRow = actionResult.rows[0];
    const openActions = actionRow ? parseInt(actionRow.open_count, 10) : 0;
    const overdueActions = actionRow ? parseInt(actionRow.overdue_count, 10) : 0;

    return {
      captured_at: new Date().toISOString(),
      posture_snapshot_id: snapshot.id,
      overall_score: snapshot.overall_score,
      overall_severity: snapshot.overall_severity,
      snapshot_date: snapshot.snapshot_date,
      domains: domainResult.rows,
      findings: {
        open: totalOpen,
        by_severity,
      },
      actions: {
        open: openActions,
        overdue: overdueActions,
      },
    };
  } catch (err) {
    logger.error(
      { event: "brief_publication_context_capture_failed", orgId, err },
      "capturePublicationContext failed — proceeding with null context"
    );
    return null;
  }
}
