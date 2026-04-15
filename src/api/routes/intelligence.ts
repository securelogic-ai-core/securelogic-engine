import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";

const router = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/* =========================================================
   GET /api/intelligence

   Returns the 10 most recent newsletter issues visible to
   the calling org: platform issues (org IS NULL) + org-owned.
   Ordered newest-first.
   ========================================================= */

router.get("/intelligence", async (req, res, next) => {
  try {
    const orgId =
      (req as any).organizationContext?.organizationId ?? null;

    const result = await pg.query(
      `
      SELECT id, title, status, audience_tier, created_at
      FROM newsletter_issues
      WHERE (organization_id IS NOT DISTINCT FROM $1 OR organization_id IS NULL)
        AND status = 'sent'
      ORDER BY created_at DESC
      LIMIT 10
      `,
      [orgId]
    );

    res.json(result.rows);
  } catch (err) {
    logger.error({ event: "intelligence_list_failed", err }, "GET /api/intelligence failed");
    next(err);
  }
});

/* =========================================================
   GET /api/intelligence/latest

   Returns the single most recent newsletter issue visible
   to the calling org.
   ========================================================= */

router.get("/intelligence/latest", async (req, res, next) => {
  try {
    const orgId =
      (req as any).organizationContext?.organizationId ?? null;

    const result = await pg.query(
      `
      SELECT id, title, status, audience_tier, summary, content_html, content_md,
             sections_json, publish_date, publication_context_json, created_at, updated_at
      FROM newsletter_issues
      WHERE (organization_id IS NOT DISTINCT FROM $1 OR organization_id IS NULL)
        AND status = 'sent'
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [orgId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "issue_not_found" });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    logger.error({ event: "intelligence_latest_failed", err }, "GET /api/intelligence/latest failed");
    next(err);
  }
});

/* =========================================================
   GET /api/intelligence/:id

   Returns a single newsletter issue by UUID, scoped to the
   calling org. Returns 404 if the issue belongs to a
   different org or does not exist.
   ========================================================= */

router.get("/intelligence/:id", async (req, res, next) => {
  try {
    const id = req.params["id"];

    if (!isValidUuid(id)) {
      res.status(400).json({ error: "invalid_issue_id" });
      return;
    }

    const orgId =
      (req as any).organizationContext?.organizationId ?? null;

    const result = await pg.query(
      `
      SELECT id, title, status, audience_tier, summary, content_html, content_md,
             sections_json, publish_date, publication_context_json, created_at, updated_at
      FROM newsletter_issues
      WHERE id = $1
        AND (organization_id IS NOT DISTINCT FROM $2 OR organization_id IS NULL)
        AND status = 'sent'
      LIMIT 1
      `,
      [id, orgId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "issue_not_found" });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    logger.error({ event: "intelligence_get_failed", err }, "GET /api/intelligence/:id failed");
    next(err);
  }
});

// ===========================================================================
// POST /api/intelligence/summary
//
// Leadership Intelligence Summary — a live structured payload for executive
// dashboards and decision support. All data comes from live DB queries.
//
// MIDDLEWARE: requireApiKey + attachOrganizationContext + requireEntitlement
// are applied to this route inline (the global /api/intelligence middleware
// chain in index.ts applies to GET routes mounted there; POST routes added
// here also need explicit guards so they are not left open).
//
// Six parallel queries are run and assembled by the pure buildLeadershipSummary
// function, which is exported for unit testing.
// ===========================================================================

// ---------------------------------------------------------------------------
// Row types — the exact shape returned by each DB query
// ---------------------------------------------------------------------------

export type TopRiskRow = {
  id: string;
  title: string;
  domain: string;
  risk_rating: string;
  status: string;
  likelihood: string | null;
  owner: string | null;
  due_date: string | null;
};

export type AffectedEntityRow = {
  entity_id: string;
  entity_name: string;
  entity_type: string;
  open_finding_count: string;
  max_severity: string;
};

export type HighCriticalFindingRow = {
  id: string;
  title: string;
  severity: string;
  domain: string | null;
  priority: string | null;
  source_type: string;
  created_at: string;
};

export type TreatmentSummaryRow = {
  in_progress_count: string;
  overdue_count: string;
  total_active_count: string;
};

export type RecentSignalRow = {
  id: string;
  source: string;
  signal_type: string;
  severity: string;
  normalized_summary: string;
  affected_vendor: string | null;
  affected_cve: string | null;
  ingestion_timestamp: string;
  linked_finding_id: string | null;
  finding_title: string | null;
  finding_severity: string | null;
  finding_domain: string | null;
};

export type PostureSnapshotRow = {
  id: string;
  snapshot_date: string;
  overall_score: number | null;
  overall_severity: string | null;
  open_finding_count: number;
};

// ---------------------------------------------------------------------------
// buildLeadershipSummary — pure, exported for unit testing
//
// Accepts raw DB rows for each of the six data sections and assembles the
// structured leadership summary payload. No I/O. All counts parsed from
// string aggregates (postgres returns numeric aggregates as strings).
// ---------------------------------------------------------------------------

export function buildLeadershipSummary(
  topRiskRows: ReadonlyArray<TopRiskRow>,
  affectedEntityRows: ReadonlyArray<AffectedEntityRow>,
  highCriticalFindingRows: ReadonlyArray<HighCriticalFindingRow>,
  treatmentSummaryRow: TreatmentSummaryRow | null,
  recentSignalRows: ReadonlyArray<RecentSignalRow>,
  currentSnapshot: PostureSnapshotRow | null,
  previousSnapshot: PostureSnapshotRow | null
): {
  top_risks: Array<{
    id: string;
    title: string;
    domain: string;
    risk_rating: string;
    status: string;
    likelihood: string | null;
    owner: string | null;
    due_date: string | null;
  }>;
  affected_entities: Array<{
    entity_id: string;
    entity_name: string;
    entity_type: string;
    open_finding_count: number;
    max_severity: string;
  }>;
  high_critical_findings: Array<{
    id: string;
    title: string;
    severity: string;
    domain: string | null;
    priority: string | null;
    source_type: string;
    created_at: string;
  }>;
  treatment_status: {
    in_progress_count: number;
    overdue_count: number;
    total_active_count: number;
  };
  recent_signals: Array<{
    id: string;
    source: string;
    signal_type: string;
    severity: string;
    normalized_summary: string;
    affected_vendor: string | null;
    affected_cve: string | null;
    ingestion_timestamp: string;
    linked_finding: {
      id: string;
      title: string;
      severity: string;
      domain: string | null;
    } | null;
  }>;
  posture: {
    current: {
      snapshot_date: string;
      overall_score: number | null;
      overall_severity: string | null;
      open_finding_count: number;
    } | null;
    previous: {
      snapshot_date: string;
      overall_score: number | null;
      overall_severity: string | null;
      open_finding_count: number;
    } | null;
    trend_direction: "improving" | "degrading" | "stable" | "insufficient_data" | "no_prior_baseline";
  };
} {
  // top_risks — pass through (already ordered by DB query)
  const topRisks = topRiskRows.map((r) => ({
    id: r.id,
    title: r.title,
    domain: r.domain,
    risk_rating: r.risk_rating,
    status: r.status,
    likelihood: r.likelihood ?? null,
    owner: r.owner ?? null,
    due_date: r.due_date ?? null
  }));

  // affected_entities — parse string counts to numbers
  const affectedEntities = affectedEntityRows.map((e) => ({
    entity_id: e.entity_id,
    entity_name: e.entity_name,
    entity_type: e.entity_type,
    open_finding_count: parseInt(e.open_finding_count, 10),
    max_severity: e.max_severity
  }));

  // high_critical_findings — pass through
  const highCriticalFindings = highCriticalFindingRows.map((f) => ({
    id: f.id,
    title: f.title,
    severity: f.severity,
    domain: f.domain ?? null,
    priority: f.priority ?? null,
    source_type: f.source_type,
    created_at: f.created_at
  }));

  // treatment_status — parse from single aggregate row
  const treatmentStatus = {
    in_progress_count: parseInt(treatmentSummaryRow?.in_progress_count ?? "0", 10),
    overdue_count: parseInt(treatmentSummaryRow?.overdue_count ?? "0", 10),
    total_active_count: parseInt(treatmentSummaryRow?.total_active_count ?? "0", 10)
  };

  // recent_signals — reshape with nested linked_finding
  const recentSignals = recentSignalRows.map((s) => ({
    id: s.id,
    source: s.source,
    signal_type: s.signal_type,
    severity: s.severity,
    normalized_summary: s.normalized_summary,
    affected_vendor: s.affected_vendor ?? null,
    affected_cve: s.affected_cve ?? null,
    ingestion_timestamp: s.ingestion_timestamp,
    linked_finding:
      s.linked_finding_id !== null
        ? {
            id: s.linked_finding_id,
            title: s.finding_title ?? "",
            severity: s.finding_severity ?? s.severity,
            domain: s.finding_domain ?? null
          }
        : null
  }));

  // posture — current + previous + trend direction
  const currentPosture = currentSnapshot !== null
    ? {
        snapshot_date: currentSnapshot.snapshot_date,
        overall_score: currentSnapshot.overall_score,
        overall_severity: currentSnapshot.overall_severity,
        open_finding_count: currentSnapshot.open_finding_count
      }
    : null;

  const previousPosture = previousSnapshot !== null
    ? {
        snapshot_date: previousSnapshot.snapshot_date,
        overall_score: previousSnapshot.overall_score,
        overall_severity: previousSnapshot.overall_severity,
        open_finding_count: previousSnapshot.open_finding_count
      }
    : null;

  let trendDirection: "improving" | "degrading" | "stable" | "insufficient_data" | "no_prior_baseline";

  if (currentSnapshot === null) {
    // No snapshot data at all — cannot determine trend.
    trendDirection = "insufficient_data";
  } else if (previousSnapshot === null) {
    // Current snapshot exists but no historical baseline to compare against.
    // This is the expected state after an organization's first posture snapshot.
    trendDirection = "no_prior_baseline";
  } else if (
    currentSnapshot.overall_score === null ||
    previousSnapshot.overall_score === null
  ) {
    trendDirection = "insufficient_data";
  } else {
    // Lower score = worse posture (higher risk). Improving = score going up.
    const delta = currentSnapshot.overall_score - previousSnapshot.overall_score;
    if (delta > 2) {
      trendDirection = "improving";
    } else if (delta < -2) {
      trendDirection = "degrading";
    } else {
      trendDirection = "stable";
    }
  }

  return {
    top_risks: topRisks,
    affected_entities: affectedEntities,
    high_critical_findings: highCriticalFindings,
    treatment_status: treatmentStatus,
    recent_signals: recentSignals,
    posture: {
      current: currentPosture,
      previous: previousPosture,
      trend_direction: trendDirection
    }
  };
}

/* =========================================================
   POST /api/intelligence/summary
   Leadership intelligence summary — live structured payload.

   Runs six parallel DB queries and assembles a response
   designed for executive dashboards and decision support.
   No mocked or hardcoded values. Every field comes from
   a live DB query scoped to the calling organization.
   ========================================================= */

router.post(
  "/intelligence/summary",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    try {
      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId ?? null;

      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      // Run all six queries in parallel.
      const [
        topRisksResult,
        affectedEntitiesResult,
        highCriticalFindingsResult,
        treatmentSummaryResult,
        recentSignalsResult,
        snapshotsResult
      ] = await Promise.all([

        // 1. Top 5 open risks by severity then recency
        pg.query<TopRiskRow>(
          `
          SELECT
            id,
            title,
            domain,
            risk_rating,
            status,
            likelihood,
            owner,
            due_date::text AS due_date
          FROM risks
          WHERE organization_id = $1
            AND status = 'open'
          ORDER BY
            CASE risk_rating
              WHEN 'Critical' THEN 1
              WHEN 'High'     THEN 2
              WHEN 'Moderate' THEN 3
              WHEN 'Low'      THEN 4
              ELSE 5
            END,
            created_at DESC
          LIMIT 5
          `,
          [organizationId]
        ),

        // 2. Entities (vendors, AI systems, dependencies) that have open findings,
        //    aggregated across all workflow source types that link to a named entity.
        //    UNION ALL paths: vendor_cycle_review → vendors,
        //                     ai_review → ai_systems (via governance_reviews),
        //                     ai_governance_review → ai_systems,
        //                     dependency_review → dependencies,
        //                     cyber_signal → vendors (via affected_vendor match).
        //    Outer GROUP BY deduplicates entities that appear in multiple paths.
        pg.query<AffectedEntityRow>(
          `
          SELECT
            entity_id,
            entity_name,
            entity_type,
            SUM(finding_count)::text AS open_finding_count,
            CASE MAX(max_sev_rank)
              WHEN 4 THEN 'Critical'
              WHEN 3 THEN 'High'
              WHEN 2 THEN 'Moderate'
              ELSE 'Low'
            END AS max_severity
          FROM (
            SELECT
              v.id  AS entity_id,
              v.name AS entity_name,
              'vendor' AS entity_type,
              COUNT(f.id) AS finding_count,
              MAX(CASE f.severity
                WHEN 'Critical' THEN 4
                WHEN 'High'     THEN 3
                WHEN 'Moderate' THEN 2
                ELSE 1
              END) AS max_sev_rank
            FROM findings f
            JOIN vendor_reviews vr
              ON vr.id = f.source_id
             AND f.source_type = 'vendor_cycle_review'
            JOIN vendors v
              ON v.id = vr.vendor_id
             AND v.organization_id = $1
            WHERE f.organization_id = $1
              AND f.status = 'open'
            GROUP BY v.id, v.name

            UNION ALL

            SELECT
              ai.id, ai.name, 'ai_system',
              COUNT(f.id),
              MAX(CASE f.severity
                WHEN 'Critical' THEN 4
                WHEN 'High'     THEN 3
                WHEN 'Moderate' THEN 2
                ELSE 1
              END)
            FROM findings f
            JOIN governance_reviews gr
              ON gr.id = f.source_id
             AND f.source_type = 'ai_review'
            JOIN ai_systems ai
              ON ai.id = gr.ai_system_id
             AND ai.organization_id = $1
            WHERE f.organization_id = $1
              AND f.status = 'open'
            GROUP BY ai.id, ai.name

            UNION ALL

            SELECT
              ai.id, ai.name, 'ai_system',
              COUNT(f.id),
              MAX(CASE f.severity
                WHEN 'Critical' THEN 4
                WHEN 'High'     THEN 3
                WHEN 'Moderate' THEN 2
                ELSE 1
              END)
            FROM findings f
            JOIN ai_governance_assessments aga
              ON aga.id = f.source_id
             AND f.source_type = 'ai_governance_review'
            JOIN ai_systems ai
              ON ai.id = aga.ai_system_id
             AND ai.organization_id = $1
            WHERE f.organization_id = $1
              AND f.status = 'open'
            GROUP BY ai.id, ai.name

            UNION ALL

            SELECT
              d.id, d.name, 'dependency',
              COUNT(f.id),
              MAX(CASE f.severity
                WHEN 'Critical' THEN 4
                WHEN 'High'     THEN 3
                WHEN 'Moderate' THEN 2
                ELSE 1
              END)
            FROM findings f
            JOIN dependency_assessments da
              ON da.id = f.source_id
             AND f.source_type = 'dependency_review'
            JOIN dependencies d
              ON d.id = da.dependency_id
             AND d.organization_id = $1
            WHERE f.organization_id = $1
              AND f.status = 'open'
            GROUP BY d.id, d.name

            UNION ALL

            SELECT
              v.id, v.name, 'vendor',
              COUNT(f.id),
              MAX(CASE f.severity
                WHEN 'Critical' THEN 4
                WHEN 'High'     THEN 3
                WHEN 'Moderate' THEN 2
                ELSE 1
              END)
            FROM findings f
            JOIN cyber_signals cs
              ON cs.id = f.source_id
             AND f.source_type = 'cyber_signal'
            JOIN vendors v
              ON v.name ILIKE cs.affected_vendor
             AND v.organization_id = $1
             AND v.status = 'active'
            WHERE f.organization_id = $1
              AND f.status = 'open'
              AND cs.affected_vendor IS NOT NULL
            GROUP BY v.id, v.name
          ) entity_paths
          GROUP BY entity_id, entity_name, entity_type
          ORDER BY MAX(max_sev_rank) DESC, SUM(finding_count) DESC
          `,
          [organizationId]
        ),

        // 3. Open findings with High or Critical severity driving posture down,
        //    ordered by severity then creation date.
        pg.query<HighCriticalFindingRow>(
          `
          SELECT
            id,
            title,
            severity,
            domain,
            priority,
            source_type,
            created_at
          FROM findings
          WHERE organization_id = $1
            AND status = 'open'
            AND severity IN ('Critical', 'High')
          ORDER BY
            CASE severity
              WHEN 'Critical' THEN 1
              WHEN 'High'     THEN 2
              ELSE 3
            END,
            created_at DESC
          LIMIT 25
          `,
          [organizationId]
        ),

        // 4. Risk treatment status: in_progress count, overdue count (past due_date
        //    and not yet in a terminal state), total active (non-terminal) count.
        pg.query<TreatmentSummaryRow>(
          `
          SELECT
            COUNT(*) FILTER (
              WHERE status = 'in_progress'
            )::text AS in_progress_count,
            COUNT(*) FILTER (
              WHERE status NOT IN ('mitigated', 'accepted', 'transferred')
                AND due_date IS NOT NULL
                AND due_date < CURRENT_DATE
            )::text AS overdue_count,
            COUNT(*) FILTER (
              WHERE status NOT IN ('mitigated', 'accepted', 'transferred')
            )::text AS total_active_count
          FROM risk_treatments
          WHERE organization_id = $1
          `,
          [organizationId]
        ),

        // 5. Cyber signals ingested in the last 7 days, with linked finding context.
        pg.query<RecentSignalRow>(
          `
          SELECT
            cs.id,
            cs.source,
            cs.signal_type,
            cs.severity,
            cs.normalized_summary,
            cs.affected_vendor,
            cs.affected_cve,
            cs.ingestion_timestamp,
            cs.linked_finding_id,
            f.title     AS finding_title,
            f.severity  AS finding_severity,
            f.domain    AS finding_domain
          FROM cyber_signals cs
          LEFT JOIN findings f
            ON f.id = cs.linked_finding_id
           AND f.organization_id = $1
          WHERE cs.organization_id = $1
            AND cs.ingestion_timestamp >= NOW() - INTERVAL '7 days'
          ORDER BY cs.ingestion_timestamp DESC
          LIMIT 25
          `,
          [organizationId]
        ),

        // 6. Two most recent posture snapshots for current state and trend comparison.
        pg.query<PostureSnapshotRow>(
          `
          SELECT
            id,
            snapshot_date,
            overall_score,
            overall_severity,
            open_finding_count
          FROM posture_snapshots
          WHERE organization_id = $1
          ORDER BY snapshot_date DESC
          LIMIT 2
          `,
          [organizationId]
        )
      ]);

      const snapshots = snapshotsResult.rows;
      const currentSnapshot = snapshots[0] ?? null;
      const previousSnapshot = snapshots[1] ?? null;

      const summary = buildLeadershipSummary(
        topRisksResult.rows,
        affectedEntitiesResult.rows,
        highCriticalFindingsResult.rows,
        treatmentSummaryResult.rows[0] ?? null,
        recentSignalsResult.rows,
        currentSnapshot,
        previousSnapshot
      );

      logger.info(
        {
          event: "intelligence_summary_generated",
          organizationId,
          topRiskCount: topRisksResult.rows.length,
          affectedEntityCount: affectedEntitiesResult.rows.length,
          highCriticalFindingCount: highCriticalFindingsResult.rows.length,
          recentSignalCount: recentSignalsResult.rows.length,
          trendDirection: summary.posture.trend_direction
        },
        "Leadership intelligence summary generated"
      );

      res.status(200).json(summary);
    } catch (err) {
      logger.error(
        { event: "intelligence_summary_failed", err },
        "POST /api/intelligence/summary failed"
      );
      res.status(500).json({ error: "intelligence_summary_failed" });
    }
  }
);

export default router;
