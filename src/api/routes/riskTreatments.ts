/**
 * riskTreatments.ts — Risk treatment workflow API
 *
 * A risk treatment is a mutable, org-scoped workflow record that tracks
 * how a risk is being addressed. Created with no side-effects.
 *
 * PARENT RISK SYNC RULE:
 *   On the FIRST PATCH transition into a terminal status
 *   (mitigated, accepted, transferred), the parent risk's status is
 *   atomically updated to match. This is unconditional — not idempotent
 *   on the risk itself, but the risk PATCH is safe to repeat.
 *
 *   not_started and in_progress transitions do not touch the parent risk.
 *
 * Evidence can be attached to a treatment record via:
 *   source_type = 'risk_treatment', source_id = risk_treatments.id
 *
 * Routes:
 *   POST  /api/risk-treatments        — create workflow record
 *   GET   /api/risk-treatments        — list for org (cursor paginated)
 *   GET   /api/risk-treatments/:id    — get single record
 *   PATCH /api/risk-treatments/:id    — transition status, sync parent risk on terminal
 *
 * Constraints:
 *   - risk_id must reference a risk belonging to the same org.
 *   - No DELETE route.
 *   - No bulk operations.
 *   - All routes use the standard middleware chain.
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import {
  validateRiskTreatmentCreate,
  validateRiskTreatmentStatusTransition,
  TERMINAL_STATUSES
} from "../lib/riskTreatmentValidation.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseLimit(value: unknown): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

const VALID_STATUS_FILTERS = new Set([
  "not_started",
  "in_progress",
  "mitigated",
  "accepted",
  "transferred"
]);

const TREATMENT_SELECT = `
  id,
  organization_id,
  risk_id,
  status,
  treatment_type,
  owner,
  due_date,
  summary,
  notes,
  performed_at,
  reviewer_id,
  created_at,
  updated_at
`;

/* =========================================================
   POST /api/risk-treatments
   Create a risk treatment workflow record.
   ========================================================= */

router.post(
  "/risk-treatments",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const validated = validateRiskTreatmentCreate(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    const client = await pg.connect();
    try {
      await client.query("BEGIN");

      // Verify the risk exists and belongs to this org.
      const riskResult = await client.query(
        `
        SELECT id, title
        FROM risks
        WHERE id = $1
          AND organization_id = $2
        FOR UPDATE
        `,
        [input.risk_id, organizationId]
      );

      if ((riskResult.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "risk_not_found" });
        return;
      }

      const treatmentResult = await client.query(
        `
        INSERT INTO risk_treatments (
          organization_id,
          risk_id,
          status,
          treatment_type,
          owner,
          due_date,
          summary,
          notes,
          performed_at,
          reviewer_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING ${TREATMENT_SELECT}
        `,
        [
          organizationId,
          input.risk_id,
          input.status,
          input.treatment_type ?? null,
          input.owner ?? null,
          input.due_date ?? null,
          input.summary ?? null,
          input.notes ?? null,
          input.performed_at ?? null,
          input.reviewer_id ?? null
        ]
      );

      const treatment = treatmentResult.rows[0];

      await client.query("COMMIT");

      logger.info(
        {
          event: "risk_treatment_created",
          organizationId,
          treatmentId: treatment.id,
          riskId: input.risk_id,
          status: input.status
        },
        "Risk treatment created"
      );

      res.status(201).json({ treatment });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }

      logger.error(
        { event: "risk_treatment_create_failed", err },
        "POST /api/risk-treatments failed"
      );
      res.status(500).json({ error: "risk_treatment_create_failed" });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   GET /api/risk-treatments
   List risk treatments for the requesting organization.
   Supports cursor pagination, risk_id filter, and status filter.
   ========================================================= */

router.get(
  "/risk-treatments",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    try {
      const limit = parseLimit(req.query.limit);
      const beforeCreatedAt = isNonEmptyString(req.query.before_created_at)
        ? req.query.before_created_at
        : null;
      const beforeId = isNonEmptyString(req.query.before_id)
        ? req.query.before_id
        : null;
      const useCursor = Boolean(beforeCreatedAt && beforeId);

      const conditions: string[] = ["organization_id = $1"];
      const params: unknown[] = [organizationId];

      // risk_id filter
      const filterRiskId = isNonEmptyString(req.query.risk_id)
        ? req.query.risk_id.trim()
        : null;
      if (filterRiskId !== null) {
        if (!isUuid(filterRiskId)) {
          res.status(400).json({ error: "risk_id_must_be_uuid" });
          return;
        }
        params.push(filterRiskId);
        conditions.push(`risk_id = $${params.length}::uuid`);
      }

      // status filter
      const filterStatus = isNonEmptyString(req.query.status)
        ? req.query.status.trim()
        : null;
      if (filterStatus !== null) {
        if (!VALID_STATUS_FILTERS.has(filterStatus)) {
          res.status(400).json({
            error: "invalid_status_filter",
            allowed: [...VALID_STATUS_FILTERS]
          });
          return;
        }
        params.push(filterStatus);
        conditions.push(`status = $${params.length}`);
      }

      if (useCursor) {
        if (!isUuid(beforeId)) {
          res.status(400).json({ error: "before_id_must_be_uuid" });
          return;
        }

        params.push(beforeCreatedAt, beforeId);
        const ci = params.length - 1;
        conditions.push(
          `(created_at, id) < ($${ci}::timestamptz, $${ci + 1}::uuid)`
        );
      }

      params.push(limit);
      const limitParam = params.length;

      const whereClause = `WHERE ${conditions.join(" AND ")}`;

      const result = await pg.query(
        `
        SELECT ${TREATMENT_SELECT}
        FROM risk_treatments
        ${whereClause}
        ORDER BY created_at DESC, id DESC
        LIMIT $${limitParam}
        `,
        params
      );

      const treatments = result.rows;
      const last =
        treatments.length > 0 ? treatments[treatments.length - 1] : null;

      res.status(200).json({
        count: treatments.length,
        limit,
        organizationId,
        nextCursor:
          last != null ? { created_at: last.created_at, id: last.id } : null,
        treatments
      });
    } catch (err) {
      logger.error(
        { event: "risk_treatments_list_failed", err },
        "GET /api/risk-treatments failed"
      );
      res.status(500).json({ error: "risk_treatments_list_failed" });
    }
  }
);

/* =========================================================
   GET /api/risk-treatments/:id
   Get a single risk treatment record.
   Returns 404 if it does not belong to this org.
   ========================================================= */

router.get(
  "/risk-treatments/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const treatmentId = String(req.params.id ?? "").trim();
    if (!treatmentId) {
      res.status(400).json({ error: "treatment_id_required" });
      return;
    }
    if (!isUuid(treatmentId)) {
      res.status(400).json({ error: "treatment_id_must_be_uuid" });
      return;
    }

    try {
      const result = await pg.query(
        `
        SELECT ${TREATMENT_SELECT}
        FROM risk_treatments
        WHERE id = $1
          AND organization_id = $2
        `,
        [treatmentId, organizationId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "risk_treatment_not_found" });
        return;
      }

      res.status(200).json({ treatment: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "risk_treatment_get_failed", err },
        "GET /api/risk-treatments/:id failed"
      );
      res.status(500).json({ error: "risk_treatment_get_failed" });
    }
  }
);

/* =========================================================
   PATCH /api/risk-treatments/:id
   Transition the status of a risk treatment.

   PARENT RISK SYNC:
   - When status transitions to a terminal value (mitigated, accepted,
     transferred), the parent risk's status is atomically updated to match.
   - not_started and in_progress transitions do not modify the parent risk.
   ========================================================= */

router.patch(
  "/risk-treatments/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const treatmentId = String(req.params.id ?? "").trim();
    if (!treatmentId) {
      res.status(400).json({ error: "treatment_id_required" });
      return;
    }
    if (!isUuid(treatmentId)) {
      res.status(400).json({ error: "treatment_id_must_be_uuid" });
      return;
    }

    const validated = validateRiskTreatmentStatusTransition(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    const client = await pg.connect();
    try {
      await client.query("BEGIN");

      // Lock the treatment row and verify org ownership.
      const treatmentResult = await client.query(
        `
        SELECT id, risk_id, status
        FROM risk_treatments
        WHERE id = $1
          AND organization_id = $2
        FOR UPDATE
        `,
        [treatmentId, organizationId]
      );

      if ((treatmentResult.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "risk_treatment_not_found" });
        return;
      }

      const existing = treatmentResult.rows[0];

      // Build the SET clause dynamically for mutable fields.
      const setClauses: string[] = ["status = $1", "updated_at = NOW()"];
      const updateParams: unknown[] = [input.status];

      if (input.treatment_type !== undefined) {
        updateParams.push(input.treatment_type);
        setClauses.push(`treatment_type = $${updateParams.length}`);
      }
      if (input.owner !== null) {
        updateParams.push(input.owner);
        setClauses.push(`owner = $${updateParams.length}`);
      }
      if (input.due_date !== null) {
        updateParams.push(input.due_date);
        setClauses.push(`due_date = $${updateParams.length}`);
      }
      if (input.summary !== null) {
        updateParams.push(input.summary);
        setClauses.push(`summary = $${updateParams.length}`);
      }
      if (input.notes !== null) {
        updateParams.push(input.notes);
        setClauses.push(`notes = $${updateParams.length}`);
      }
      if (input.performed_at !== null) {
        updateParams.push(input.performed_at);
        setClauses.push(`performed_at = $${updateParams.length}`);
      }
      if (input.reviewer_id !== null) {
        updateParams.push(input.reviewer_id);
        setClauses.push(`reviewer_id = $${updateParams.length}`);
      }

      updateParams.push(treatmentId, organizationId);
      const idParam = updateParams.length - 1;
      const orgParam = updateParams.length;

      const updatedResult = await client.query(
        `
        UPDATE risk_treatments
        SET ${setClauses.join(", ")}
        WHERE id = $${idParam}
          AND organization_id = $${orgParam}
        RETURNING ${TREATMENT_SELECT}
        `,
        updateParams
      );

      const treatment = updatedResult.rows[0];

      let riskUpdated = false;

      // Atomically update parent risk status when transitioning to terminal.
      if (TERMINAL_STATUSES.has(input.status)) {
        // Map treatment terminal status to risk status (1-to-1 match).
        await client.query(
          `
          UPDATE risks
          SET status = $1, updated_at = NOW()
          WHERE id = $2
            AND organization_id = $3
          `,
          [input.status, existing.risk_id, organizationId]
        );
        riskUpdated = true;
      }

      await client.query("COMMIT");

      logger.info(
        {
          event: "risk_treatment_status_updated",
          organizationId,
          treatmentId,
          riskId: existing.risk_id,
          status: input.status,
          riskUpdated
        },
        "Risk treatment status updated"
      );

      res.status(200).json({ treatment });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }

      logger.error(
        { event: "risk_treatment_patch_failed", err },
        "PATCH /api/risk-treatments/:id failed"
      );
      res.status(500).json({ error: "risk_treatment_patch_failed" });
    } finally {
      client.release();
    }
  }
);

export default router;
