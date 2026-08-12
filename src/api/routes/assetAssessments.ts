/**
 * assetAssessments.ts — the generic asset-assessment surface (EAR P10).
 *
 * Design authority: docs/architecture/enterprise-asset-registry/
 * P10-ASSESSMENT-SERVICE-MEMO.md. ONE workflow for ANY registry asset
 * (AssetRef subject) — the exit criterion for Track B: new asset types gain
 * an assessment path with zero new tables, routes, or validation modules.
 *
 * Auth chain (same as the registry surface): assetRegistryFeatureFlag (404s
 * the whole surface BEFORE auth while SECURELOGIC_ASSET_REGISTRY_ENABLED is
 * off — default everywhere) → requireApiKey → attachOrganizationContext →
 * requirePremiumOrCorePlatform (P9 dual-gate) → asTenant.
 *
 * Transactions live in assessmentEngine.ts (the spec-driven engine); this
 * file owns HTTP shape, validation dispatch, logging, and audit events —
 * mirroring the obligation-assessment stack (the P10 template).
 */

import { Router } from "express";

import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { asTenant } from "../middleware/asTenant.js";
import { requirePremiumOrCorePlatform } from "../lib/corePlatformCapability.js";
import { assetRegistryFeatureFlag } from "../lib/assetRegistryFeatureFlag.js";
import { isAssetType } from "../lib/assetRegistry.js";
import {
  validateAssetAssessmentCreate,
  validateAssetAssessmentStatusTransition,
  isUuid
} from "../lib/assetAssessmentValidation.js";
import {
  createAssetAssessment,
  transitionAssetAssessment
} from "../lib/assessmentEngine.js";
import { writeAuditEvent } from "../lib/auditLog.js";

const router = Router();

const ASSESSMENT_SELECT = `
  id,
  organization_id,
  asset_type,
  asset_id,
  status,
  overall_severity,
  summary,
  notes,
  performed_at,
  reviewer_uuid AS reviewer_id,
  created_at,
  updated_at
`;

/* =========================================================
   POST /api/asset-assessments
   Create an assessment workflow record for any registry asset.
   No finding is created at this step.
   ========================================================= */

router.post(
  "/asset-assessments",
  assetRegistryFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requirePremiumOrCorePlatform,
  denyContributor(),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const validated = validateAssetAssessmentCreate(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    try {
      const result = await createAssetAssessment(organizationId, validated.input);

      if ("error" in result) {
        res.status(404).json({ error: result.error });
        return;
      }

      logger.info(
        {
          event: "asset_assessment_created",
          organizationId,
          assessmentId: result.assessment["id"],
          assetType: validated.input.asset_type,
          assetId: validated.input.asset_id,
          status: validated.input.status
        },
        "Asset assessment created"
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId: req.userId ?? null,
        eventType: "workflow.created",
        resourceType: "asset_assessment",
        resourceId: String(result.assessment["id"]),
        payload: {
          asset_type: validated.input.asset_type,
          asset_id: validated.input.asset_id,
          status: validated.input.status
        },
        ipAddress: req.ip ?? null
      });

      res.status(201).json({ assessment: result.assessment });
    } catch (err) {
      logger.error(
        { event: "asset_assessment_create_failed", err },
        "POST /api/asset-assessments failed"
      );
      res.status(500).json({ error: "asset_assessment_create_failed" });
    }
  })
);

/* =========================================================
   GET /api/asset-assessments
   Org-scoped list with optional asset_type / asset_id / status filters.
   ========================================================= */

router.get(
  "/asset-assessments",
  assetRegistryFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requirePremiumOrCorePlatform,
  denyContributor(),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const conditions: string[] = ["organization_id = $1"];
    const params: unknown[] = [organizationId];

    const assetType = typeof req.query.asset_type === "string" ? req.query.asset_type : null;
    if (assetType !== null) {
      if (!isAssetType(assetType)) {
        res.status(400).json({ error: "invalid_asset_type" });
        return;
      }
      params.push(assetType);
      conditions.push(`asset_type = $${params.length}`);
    }

    const assetId = typeof req.query.asset_id === "string" ? req.query.asset_id : null;
    if (assetId !== null) {
      if (!isUuid(assetId)) {
        res.status(400).json({ error: "asset_id_must_be_uuid" });
        return;
      }
      params.push(assetId);
      conditions.push(`asset_id = $${params.length}`);
    }

    const status = typeof req.query.status === "string" ? req.query.status : null;
    if (status !== null) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    const limitRaw = Number.parseInt(String(req.query.limit ?? "50"), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
    const offsetRaw = Number.parseInt(String(req.query.offset ?? "0"), 10);
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

    try {
      const result = await pg.query(
        `
        SELECT ${ASSESSMENT_SELECT}
        FROM asset_assessments
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit} OFFSET ${offset}
        `,
        params
      );

      res.status(200).json({
        assessments: result.rows,
        count: result.rowCount ?? 0,
        limit,
        offset
      });
    } catch (err) {
      logger.error(
        { event: "asset_assessments_list_failed", err },
        "GET /api/asset-assessments failed"
      );
      res.status(500).json({ error: "asset_assessments_list_failed" });
    }
  })
);

/* =========================================================
   GET /api/asset-assessments/:id
   ========================================================= */

router.get(
  "/asset-assessments/:id",
  assetRegistryFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requirePremiumOrCorePlatform,
  denyContributor(),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const assessmentId = String(req.params.id ?? "").trim();
    if (!isUuid(assessmentId)) {
      res.status(400).json({ error: "assessment_id_must_be_uuid" });
      return;
    }

    try {
      const result = await pg.query(
        `
        SELECT ${ASSESSMENT_SELECT}
        FROM asset_assessments
        WHERE id = $1
          AND organization_id = $2
        LIMIT 1
        `,
        [assessmentId, organizationId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "asset_assessment_not_found" });
        return;
      }

      res.status(200).json({ assessment: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "asset_assessment_get_failed", err },
        "GET /api/asset-assessments/:id failed"
      );
      res.status(500).json({ error: "asset_assessment_get_failed" });
    }
  })
);

/* =========================================================
   PATCH /api/asset-assessments/:id
   Spec-driven status transition; finding on the FIRST transition
   into a finding-triggering status.
   ========================================================= */

router.patch(
  "/asset-assessments/:id",
  assetRegistryFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requirePremiumOrCorePlatform,
  denyContributor(),
  asTenant(async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const assessmentId = String(req.params.id ?? "").trim();
    if (!isUuid(assessmentId)) {
      res.status(400).json({ error: "assessment_id_must_be_uuid" });
      return;
    }

    const validated = validateAssetAssessmentStatusTransition(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    try {
      const result = await transitionAssetAssessment(
        organizationId,
        assessmentId,
        validated.input
      );

      if ("error" in result) {
        if (result.error === "not_found") {
          res.status(404).json({ error: "asset_assessment_not_found" });
        } else if (result.error === "workflow_terminal") {
          res.status(409).json({
            error: "workflow_terminal",
            message: "This record is in a terminal state and cannot be modified."
          });
        } else {
          res.status(422).json({ error: "invalid_transition" });
        }
        return;
      }

      logger.info(
        {
          event: "asset_assessment_status_updated",
          organizationId,
          assessmentId,
          status: validated.input.status,
          findingCreated: result.finding !== null
        },
        "Asset assessment status updated"
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId: req.userId ?? null,
        eventType: "workflow.status_transition",
        resourceType: "asset_assessment",
        resourceId: assessmentId,
        payload: {
          from: result.from,
          to: validated.input.status,
          findingCreated: result.finding !== null
        },
        ipAddress: req.ip ?? null
      });

      res.status(200).json({ assessment: result.assessment, finding: result.finding });
    } catch (err) {
      logger.error(
        { event: "asset_assessment_patch_failed", err },
        "PATCH /api/asset-assessments/:id failed"
      );
      res.status(500).json({ error: "asset_assessment_patch_failed" });
    }
  })
);

export default router;
