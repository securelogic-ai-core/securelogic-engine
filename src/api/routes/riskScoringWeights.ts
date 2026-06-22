/**
 * riskScoringWeights.ts — Customer-configurable per-org weights driving
 * computeRiskScore. One row per organization in risk_scoring_weights.
 *
 * ROUTES
 *   GET /api/risk-scoring-weights  — return the org's current weights,
 *                                     falling back to DEFAULT_WEIGHTS
 *                                     when no row exists. The response
 *                                     payload is identical in shape
 *                                     either way; an `is_default`
 *                                     boolean indicates fallback.
 *   PUT /api/risk-scoring-weights  — replace the org's weights with the
 *                                     validated request body. Upserts on
 *                                     organization_id (one row per org).
 *
 * TENANT RULES (TENANT_ISOLATION_STANDARD.md §1, §4, §8)
 *   - organization_id is sourced from req.organizationContext, never
 *     from the request body.
 *   - PUT body is structurally validated (exact key sets, values in
 *     (0, 1]) before any DB write.
 *   - Audit-log every PUT via writeAuditEvent.
 *
 * NOT IN SCOPE FOR THIS PACKAGE
 *   - Recompute existing match_scores when weights change. (Future
 *     batch package; the per-suggestion recompute endpoint in
 *     signalMatchSuggestions.ts is the foundation.)
 *   - PATCH semantics for partial weight updates. PUT replaces the
 *     entire row; if a customer wants to change one band, they send
 *     the full set.
 *   - UI for editing weights. (Separate UI package.)
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { DEFAULT_WEIGHTS, type RiskScoringWeights } from "../lib/riskScoring.js";
import { validateRiskScoringWeightsPut } from "../lib/riskScoringWeightsValidation.js";

const router = Router();

const WEIGHTS_SELECT = `
  id,
  organization_id,
  entity_criticality_weights,
  obligation_priority_weights,
  severity_weights,
  created_at,
  updated_at,
  updated_by_user_id
`;

function getOrgId(req: Request): string | null {
  const ctx = (req as unknown as {
    organizationContext?: { organizationId?: string };
  }).organizationContext;
  return ctx?.organizationId ?? null;
}

function getApiKeyId(req: Request): string | null {
  return (req as unknown as { apiKey?: { id?: string } }).apiKey?.id ?? null;
}

/* =========================================================
   GET /api/risk-scoring-weights
   Return the org's current weights, falling back to DEFAULT_WEIGHTS
   when no row exists. is_default=true means the response is built
   from the documented defaults (no DB row).
   ========================================================= */

export async function getRiskScoringWeights(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  try {
    const result = await pg.query(
      `SELECT ${WEIGHTS_SELECT}
         FROM risk_scoring_weights
        WHERE organization_id = $1
        LIMIT 1`,
      [organizationId]
    );

    if ((result.rowCount ?? 0) === 0) {
      // No row for this org — return documented defaults.
      res.status(200).json({
        is_default: true,
        organization_id: organizationId,
        weights: DEFAULT_WEIGHTS
      });
      return;
    }

    const row = result.rows[0];
    res.status(200).json({
      is_default: false,
      organization_id: organizationId,
      weights: {
        entity_criticality_weights: row.entity_criticality_weights,
        obligation_priority_weights: row.obligation_priority_weights,
        severity_weights: row.severity_weights
      },
      created_at: row.created_at,
      updated_at: row.updated_at,
      updated_by_user_id: row.updated_by_user_id
    });
  } catch (err) {
    logger.error(
      { event: "risk_scoring_weights_get_failed", err },
      "GET /api/risk-scoring-weights failed"
    );
    res.status(500).json({ error: "risk_scoring_weights_get_failed" });
  }
}

/* =========================================================
   PUT /api/risk-scoring-weights
   Replace the org's weights with the validated request body.
   Upserts on organization_id — one row per org.
   ========================================================= */

export async function putRiskScoringWeights(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const validated = validateRiskScoringWeightsPut(req.body);
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }

  const weights: RiskScoringWeights = validated.input;

  try {
    const result = await pg.query(
      `INSERT INTO risk_scoring_weights (
         organization_id,
         entity_criticality_weights,
         obligation_priority_weights,
         severity_weights,
         updated_by_user_id
       )
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (organization_id) DO UPDATE
         SET entity_criticality_weights  = EXCLUDED.entity_criticality_weights,
             obligation_priority_weights = EXCLUDED.obligation_priority_weights,
             severity_weights            = EXCLUDED.severity_weights,
             updated_at                  = NOW(),
             updated_by_user_id          = EXCLUDED.updated_by_user_id
       RETURNING ${WEIGHTS_SELECT}`,
      [
        organizationId,
        JSON.stringify(weights.entity_criticality_weights),
        JSON.stringify(weights.obligation_priority_weights),
        JSON.stringify(weights.severity_weights),
        req.userId ?? null
      ]
    );

    const row = result.rows[0];

    logger.info(
      {
        event: "risk_scoring_weights_updated",
        organizationId,
        rowId: row.id
      },
      "Risk scoring weights updated"
    );

    writeAuditEvent({
      organizationId,
      actorApiKeyId: getApiKeyId(req),
      actorUserId: req.userId ?? null,
      eventType: "risk_scoring_weights.updated",
      resourceType: "risk_scoring_weights",
      resourceId: row.id as string,
      payload: {
        entity_criticality_weights: weights.entity_criticality_weights,
        obligation_priority_weights: weights.obligation_priority_weights,
        severity_weights: weights.severity_weights
      },
      ipAddress: req.ip ?? null
    });

    res.status(200).json({
      is_default: false,
      organization_id: organizationId,
      weights: {
        entity_criticality_weights: row.entity_criticality_weights,
        obligation_priority_weights: row.obligation_priority_weights,
        severity_weights: row.severity_weights
      },
      created_at: row.created_at,
      updated_at: row.updated_at,
      updated_by_user_id: row.updated_by_user_id
    });
  } catch (err) {
    logger.error(
      { event: "risk_scoring_weights_put_failed", err },
      "PUT /api/risk-scoring-weights failed"
    );
    res.status(500).json({ error: "risk_scoring_weights_put_failed" });
  }
}

/* =========================================================
   Router wiring — handlers above are exported by name for
   direct invocation in targeted behavioral tests.
   ========================================================= */

router.get(
  "/risk-scoring-weights",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  getRiskScoringWeights
);

router.put(
  "/risk-scoring-weights",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  putRiskScoringWeights
);

export default router;
