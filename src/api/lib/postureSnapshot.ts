/**
 * postureSnapshot.ts — Shared posture snapshot computation and persistence.
 *
 * Called by POST /api/posture/snapshot (HTTP route) and the posture worker
 * (scheduled background job). Centralises the compute + write logic so both
 * callers stay consistent. Adds trend_direction per domain by comparing new
 * scores to the most recent prior snapshot for the org.
 */

import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import {
  computePosture,
  FALLBACK_CONTEXT,
  type DbFindingForPosture,
  type OrgContext,
  type DomainScoreResult,
} from "./postureComputation.js";
import {
  buildWorkflowSignalBreakdown,
  buildScoringRationaleExtension,
} from "./workflowScoringIntegration.js";
import { vendorCriticalityToSignals } from "./inventoryToSignals.js";

// ─────────────────────────────────────────────────────────────────────────────

export type DomainScoreWithTrend = DomainScoreResult & {
  trend_direction: "improving" | "stable" | "worsening" | "unknown";
};

export type SnapshotResult = {
  snapshotId: string;
  snapshotDate: string;
  overallScore: number | null;
  overallSeverity: string | null;
  openFindingCount: number;
  openActionCount: number;
  overdueActionCount: number;
  domainScores: DomainScoreWithTrend[];
  computationRationale: Record<string, unknown>;
};

// ─────────────────────────────────────────────────────────────────────────────

function trendDirection(
  domain: string,
  newScore: number | null,
  prevByDomain: Map<string, number | null>
): "improving" | "stable" | "worsening" | "unknown" {
  if (!prevByDomain.has(domain)) return "unknown";
  const prev = prevByDomain.get(domain) ?? null;
  if (prev === null || newScore === null) return "unknown";
  if (newScore - prev >= 5) return "improving";
  if (prev - newScore >= 5) return "worsening";
  return "stable";
}

// ─────────────────────────────────────────────────────────────────────────────

export async function computeAndSavePostureSnapshot(
  organizationId: string
): Promise<SnapshotResult> {
  // ── 1. Org context ──────────────────────────────────────────────────────
  const orgProfileResult = await pg.query<{
    regulated: boolean;
    handles_pii: boolean;
    safety_critical: boolean;
    scale: string;
  }>(
    `SELECT regulated, handles_pii, safety_critical, scale
     FROM organizations WHERE id = $1`,
    [organizationId]
  );

  let orgContext: OrgContext;
  if ((orgProfileResult.rowCount ?? 0) === 0) {
    logger.warn(
      { event: "posture_snapshot_org_not_found", organizationId },
      "org profile not found for posture computation — falling back to FALLBACK_CONTEXT"
    );
    orgContext = FALLBACK_CONTEXT;
  } else {
    const row = orgProfileResult.rows[0]!;
    const validScales = new Set(["Small", "Medium", "Enterprise"]);
    orgContext = {
      regulated: row.regulated,
      handlesPII: row.handles_pii,
      safetyCritical: row.safety_critical,
      scale: validScales.has(row.scale)
        ? (row.scale as OrgContext["scale"])
        : "Small",
    };
  }

  // ── 2. Signal + action + prior-snapshot fetch (SEQUENTIAL — see below) ──
  // These 7 reads were previously issued via `Promise.all`. Under A04-G1
  // phase 1 (PR 6, the withTenant wrap — Decision B1) this function runs
  // inside ONE per-tenant transaction, so every `pg.query()` routes to the
  // single tenant client. node-postgres cannot multiplex concurrent queries
  // on one client: it serializes them and emits
  //   DeprecationWarning: Calling client.query() when the client is already
  //   executing a query …  — which becomes a hard throw under pg@9.
  // So the `Promise.all` was illusory parallelism plus a deprecation source:
  // the queries already ran one-at-a-time on the tenant client. Sequential
  // awaits make the real execution shape explicit. This is the
  // platform-correct END STATE, not a perf regression to "re-parallelize
  // later": the only other caller (POST /api/posture/snapshot, the engine
  // route) will also become withTenant-scoped after PR 7's RLS flip, leaving
  // no caller that could legitimately run these in parallel on the pool.
  // The reads are independent SELECTs across different tables with no
  // inter-query data dependency, so execution order does not affect results.
  const findingsResult = await pg.query<DbFindingForPosture>(
    `SELECT id, title, domain, severity FROM findings
     WHERE organization_id = $1 AND status = 'open'`,
    [organizationId]
  );

  // Engine consumes RESIDUAL rating per Decision §4 — the
  // post-controls assessment of current-state risk. Risks without a
  // residual_rating are excluded (the IS NOT NULL filter implements
  // the spec's fallback rule: skip, do NOT fall back to inherent).
  // After Phase 1 backfill, every existing row has residual = legacy,
  // so scoring stays unchanged for orgs that had data before this
  // package shipped.
  const risksResult = await pg.query<{ id: string; title: string; domain: string; residual_rating: string }>(
    `SELECT id, title, domain, residual_rating FROM risks
     WHERE organization_id = $1
       AND status = 'open'
       AND residual_rating IS NOT NULL`,
    [organizationId]
  );

  const findingBreakdownResult = await pg.query<{ source_type: string; count: string }>(
    `SELECT source_type, COUNT(*)::text AS count FROM findings
     WHERE organization_id = $1 AND status = 'open'
     GROUP BY source_type`,
    [organizationId]
  );

  const treatedRiskResult = await pg.query<{ count: string }>(
    `SELECT COUNT(DISTINCT r.id)::text AS count
     FROM risks r
     JOIN risk_treatments rt
       ON rt.risk_id = r.id
      AND rt.organization_id = $1
      AND rt.status IN ('not_started', 'in_progress')
     WHERE r.organization_id = $1 AND r.status = 'open'`,
    [organizationId]
  );

  const actionCountResult = await pg.query<{ open_count: string; overdue_count: string }>(
    `SELECT
       COUNT(*)::text AS open_count,
       COUNT(*) FILTER (
         WHERE due_date < CURRENT_DATE
           AND status NOT IN ('closed', 'accepted')
       )::text AS overdue_count
     FROM actions
     WHERE organization_id = $1
       AND status NOT IN ('closed', 'accepted')`,
    [organizationId]
  );

  // Most recent prior snapshot's domain scores — for trend direction
  const prevDomainResult = await pg.query<{ domain: string; score: number | null }>(
    `WITH prev AS (
       SELECT id FROM posture_snapshots
       WHERE organization_id = $1
         AND snapshot_date < CURRENT_DATE
       ORDER BY snapshot_date DESC
       LIMIT 1
     )
     SELECT ds.domain, ds.score
     FROM domain_scores ds
     JOIN prev ON prev.id = ds.posture_snapshot_id`,
    [organizationId]
  );

  // Active vendors with non-null criticality. Used to synthesize
  // Vendor Risk domain signals so inventory state influences
  // posture even when no vendor findings or risks are open. See
  // src/api/lib/inventoryToSignals.ts for rationale.
  const vendorInventoryResult = await pg.query<{ id: string; criticality: string }>(
    `SELECT id, criticality FROM vendors
     WHERE organization_id = $1
       AND status = 'active'
       AND criticality IS NOT NULL`,
    [organizationId]
  );

  // ── 3. Assemble signals ─────────────────────────────────────────────────
  const riskSignals: DbFindingForPosture[] = risksResult.rows.map((r) => ({
    id: r.id,
    title: r.title,
    domain: r.domain,
    severity: r.residual_rating,
  }));

  // Synthetic Vendor Risk signals from active inventory. Same
  // DbFindingForPosture shape as real findings — the engine sees one
  // merged array and treats them identically. The synthesis function
  // skips null/unknown criticality defensively (the SQL filter
  // already excludes nulls, but double-skipping is cheap insurance).
  const vendorInventorySignals = vendorCriticalityToSignals(
    vendorInventoryResult.rows
  );

  const openFindings = [
    ...findingsResult.rows,
    ...riskSignals,
    ...vendorInventorySignals,
  ];
  const riskSignalCount = riskSignals.length;

  const actionRow = actionCountResult.rows[0];
  const openActionCount  = actionRow ? parseInt(actionRow.open_count,    10) : 0;
  const overdueActionCount = actionRow ? parseInt(actionRow.overdue_count, 10) : 0;

  // ── 4. Workflow signal breakdown for rationale ──────────────────────────
  const risksWithActiveTreatment = parseInt(
    treatedRiskResult.rows[0]?.count ?? "0",
    10
  );
  const signalBreakdown = buildWorkflowSignalBreakdown(
    findingBreakdownResult.rows,
    riskSignalCount,
    risksWithActiveTreatment
  );
  const rationaleExtension = buildScoringRationaleExtension(signalBreakdown);

  // ── 5. Compute posture ──────────────────────────────────────────────────
  const computed = computePosture(
    openFindings,
    openActionCount,
    overdueActionCount,
    orgContext,
    riskSignalCount
  );
  const enrichedRationale = { ...computed.computation_rationale, ...rationaleExtension };

  // ── 6. Build prev domain score map for trend ────────────────────────────
  const prevByDomain = new Map<string, number | null>();
  for (const row of prevDomainResult.rows) {
    prevByDomain.set(row.domain, row.score);
  }

  const domainScoresWithTrend: DomainScoreWithTrend[] = computed.domain_scores.map(
    (ds) => ({
      ...ds,
      trend_direction: trendDirection(ds.domain, ds.score, prevByDomain),
    })
  );

  // ── 7. Write snapshot + domain scores in a transaction ──────────────────
  const client = await pg.connect();
  try {
    await client.query("BEGIN");

    const snapshotResult = await client.query<{ id: string; snapshot_date: string }>(
      `INSERT INTO posture_snapshots (
         organization_id, snapshot_date,
         overall_score, overall_severity,
         open_finding_count, open_action_count,
         overdue_action_count, computation_rationale
       )
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (organization_id, snapshot_date) DO UPDATE SET
         overall_score         = EXCLUDED.overall_score,
         overall_severity      = EXCLUDED.overall_severity,
         open_finding_count    = EXCLUDED.open_finding_count,
         open_action_count     = EXCLUDED.open_action_count,
         overdue_action_count  = EXCLUDED.overdue_action_count,
         computation_rationale = EXCLUDED.computation_rationale,
         created_at            = NOW()
       RETURNING id, snapshot_date`,
      [
        organizationId,
        computed.overall_score,
        computed.overall_severity,
        computed.open_finding_count,
        computed.open_action_count,
        computed.overdue_action_count,
        JSON.stringify(enrichedRationale),
      ]
    );

    const snapshotRow = snapshotResult.rows[0];
    if (!snapshotRow) throw new Error("posture_snapshot_insert_returned_no_row");
    const snapshotId = snapshotRow.id;

    await client.query(
      `DELETE FROM domain_scores WHERE posture_snapshot_id = $1`,
      [snapshotId]
    );

    if (domainScoresWithTrend.length > 0) {
      const vals: unknown[] = [];
      const placeholders: string[] = [];

      domainScoresWithTrend.forEach((ds, i) => {
        const b = i * 7;
        placeholders.push(
          `($${b+1}, $${b+2}, $${b+3}, $${b+4}, $${b+5}, $${b+6}, $${b+7})`
        );
        vals.push(
          snapshotId,
          ds.domain,
          ds.score,
          ds.severity,
          ds.finding_count,
          ds.trend_direction,
          ds.rationale
        );
      });

      await client.query(
        `INSERT INTO domain_scores (
           posture_snapshot_id, domain, score, severity,
           finding_count, trend_direction, rationale
         )
         VALUES ${placeholders.join(", ")}`,
        vals
      );
    }

    await client.query("COMMIT");

    logger.info(
      {
        event: "posture_snapshot_created",
        organizationId,
        snapshotId,
        overallScore: computed.overall_score,
        domainCount: domainScoresWithTrend.length,
        openFindingCount: computed.open_finding_count,
      },
      "Posture snapshot created"
    );

    return {
      snapshotId,
      snapshotDate: snapshotRow.snapshot_date,
      overallScore: computed.overall_score,
      overallSeverity: computed.overall_severity,
      openFindingCount: computed.open_finding_count,
      openActionCount,
      overdueActionCount,
      domainScores: domainScoresWithTrend,
      computationRationale: enrichedRationale,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
