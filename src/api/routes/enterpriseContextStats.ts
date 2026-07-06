/**
 * enterpriseContextStats.ts — R6: the first-class ECL stats/rollup endpoint.
 *
 *   GET /api/enterprise-context/stats
 *
 * One org-scoped aggregation surface for the executive dashboard (and any other
 * rollup consumer). The governing docs prohibit ad-hoc aggregation over the
 * page-capped list APIs — this endpoint IS the sanctioned aggregation:
 *
 *   entities       — total + by type + by criticality (the context inventory)
 *   relationships  — live edge count (soft-deleted excluded)
 *   applicability  — CURRENT decisions only (latest per (signal, target) by
 *                    `seq`): count by decision, blast-radius reach (distinct
 *                    affected nodes across current decisions), high-confidence
 *                    affected count
 *   workflow       — pending match suggestions; open dispatcher-generated
 *                    findings/actions (source_type 'applicability_assessment')
 *   assets         — EAR Phase 5: registry-wide rollup over asset_registry_v
 *                    (total + by asset_type + by criticality across ALL asset
 *                    types). Present ONLY while SECURELOGIC_ASSET_REGISTRY_ENABLED
 *                    is on — response unchanged for existing consumers otherwise.
 *
 * Read-only, four aggregate queries, all org-scoped by parameter inside the
 * asTenant transaction. Route chain mirrors every ECL route: flag FIRST
 * (404 while dark) → auth → org context → capability → asTenant.
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireCapability } from "../lib/enterpriseContextCapability.js";
import { asTenant } from "../middleware/asTenant.js";
import { enterpriseContextFeatureFlag } from "../lib/enterpriseContextFeatureFlag.js";
import { assetRegistryEnabled } from "../lib/assetRegistryFeatureFlag.js";

const router = Router();

function getOrgId(req: Request): string | null {
  return (
    (req as { organizationContext?: { organizationId?: string | null } })
      .organizationContext?.organizationId ?? null
  );
}

function tally(rows: Array<Record<string, unknown>>, key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = r[key];
    if (typeof k !== "string" || k.length === 0) continue;
    out[k] = (out[k] ?? 0) + Number(r.n);
  }
  return out;
}

export async function getEnterpriseContextStats(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  // 1. Entity inventory rollup.
  const entities = await pg.query(
    `SELECT entity_type, criticality, count(*)::int AS n
       FROM enterprise_entities
      WHERE organization_id = $1
      GROUP BY entity_type, criticality`,
    [orgId]
  );
  const entityTotal = entities.rows.reduce((s, r) => s + Number((r as Record<string, unknown>).n), 0);

  // 2. Live relationship count.
  const edges = await pg.query(
    `SELECT count(*)::int AS n
       FROM enterprise_relationships
      WHERE organization_id = $1 AND deleted_at IS NULL`,
    [orgId]
  );

  // 3. Applicability rollup over CURRENT decisions only.
  const applicability = await pg.query(
    `WITH current AS (
       SELECT DISTINCT ON (signal_id, target_type, target_id) id, decision, confidence_band
         FROM applicability_assessments
        WHERE organization_id = $1
        ORDER BY signal_id, target_type, target_id, seq DESC
     )
     SELECT
       (SELECT count(*)::int FROM current) AS current_total,
       (SELECT count(*)::int FROM current WHERE decision = 'affected') AS affected,
       (SELECT count(*)::int FROM current WHERE decision = 'potentially_affected') AS potentially_affected,
       (SELECT count(*)::int FROM current WHERE decision = 'needs_review') AS needs_review,
       (SELECT count(*)::int FROM current WHERE decision = 'not_affected') AS not_affected,
       (SELECT count(*)::int FROM current WHERE decision = 'unknown') AS unknown,
       (SELECT count(*)::int FROM current WHERE decision = 'affected' AND confidence_band = 'high') AS affected_high_confidence,
       (SELECT count(*)::int FROM applicability_assessments WHERE organization_id = $1) AS total_assessments,
       (SELECT count(DISTINCT (ae.node_type, ae.node_id))::int
          FROM applicability_affected_entities ae
          JOIN current c ON c.id = ae.assessment_id
         WHERE ae.organization_id = $1) AS blast_radius_nodes`,
    [orgId]
  );
  const ap = applicability.rows[0] as Record<string, unknown>;

  // 4. Workflow queue rollup (dispatcher-generated surfaces).
  const workflow = await pg.query(
    `SELECT
       (SELECT count(*)::int FROM signal_match_suggestions
         WHERE organization_id = $1 AND accepted_at IS NULL AND dismissed_at IS NULL) AS pending_suggestions,
       (SELECT count(*)::int FROM findings
         WHERE organization_id = $1 AND source_type = 'applicability_assessment' AND status = 'open') AS open_findings,
       (SELECT count(*)::int FROM actions
         WHERE organization_id = $1 AND source_type = 'applicability_assessment' AND status = 'open') AS open_actions`,
    [orgId]
  );
  const wf = workflow.rows[0] as Record<string, unknown>;

  // 5. EAR Phase 5: registry-wide asset rollup over asset_registry_v — the
  // exec-dashboard asset-totals surface across ALL asset types (vendors,
  // AI systems, entities, and the Phase-3a native types). Flag-gated: the
  // key is ABSENT while SECURELOGIC_ASSET_REGISTRY_ENABLED is off, so the
  // response stays byte-identical for existing consumers.
  let assets:
    | { total: number; by_type: Record<string, number>; by_criticality: Record<string, number> }
    | undefined;
  if (assetRegistryEnabled()) {
    const registry = await pg.query(
      `SELECT asset_type, criticality, count(*)::int AS n
         FROM asset_registry_v
        WHERE organization_id = $1
        GROUP BY asset_type, criticality`,
      [orgId]
    );
    assets = {
      total: registry.rows.reduce((s, r) => s + Number((r as Record<string, unknown>).n), 0),
      by_type: tally(registry.rows as Array<Record<string, unknown>>, "asset_type"),
      by_criticality: tally(registry.rows as Array<Record<string, unknown>>, "criticality")
    };
  }

  res.status(200).json({
    stats: {
      ...(assets ? { assets } : {}),
      entities: {
        total: entityTotal,
        by_type: tally(entities.rows as Array<Record<string, unknown>>, "entity_type"),
        by_criticality: tally(entities.rows as Array<Record<string, unknown>>, "criticality")
      },
      relationships: {
        total: Number((edges.rows[0] as Record<string, unknown>).n)
      },
      applicability: {
        current_total: Number(ap.current_total),
        by_decision: {
          affected: Number(ap.affected),
          potentially_affected: Number(ap.potentially_affected),
          needs_review: Number(ap.needs_review),
          not_affected: Number(ap.not_affected),
          unknown: Number(ap.unknown)
        },
        affected_high_confidence: Number(ap.affected_high_confidence),
        total_assessments: Number(ap.total_assessments),
        blast_radius_nodes: Number(ap.blast_radius_nodes)
      },
      workflow: {
        pending_suggestions: Number(wf.pending_suggestions),
        open_findings: Number(wf.open_findings),
        open_actions: Number(wf.open_actions)
      }
    }
  });
}

const chain = [
  enterpriseContextFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireCapability("enterprise_context")
];

router.get("/enterprise-context/stats", ...chain, asTenant(getEnterpriseContextStats));

export default router;
