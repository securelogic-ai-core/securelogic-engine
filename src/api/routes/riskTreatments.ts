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
import { asTenant } from "../middleware/asTenant.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  validateRiskTreatmentCreate,
  validateRiskTreatmentStatusTransition,
  TERMINAL_STATUSES,
  isValidTransition
} from "../lib/riskTreatmentValidation.js";
import { resolveOwnerUserSameOrg } from "../lib/ownerUserResolver.js";

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
  owner_user_id,
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
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
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

      // Resolve owner_user_id (same-org check) and denormalize the
      // user's name into the legacy `owner` TEXT column when the caller
      // did not supply an explicit owner string.
      let ownerText: string | null = input.owner;
      if (input.owner_user_id !== null) {
        const resolved = await resolveOwnerUserSameOrg(
          client,
          input.owner_user_id,
          organizationId
        );
        if ("error" in resolved) {
          await client.query("ROLLBACK");
          res.status(400).json({
            error: "invalid_owner_user_id",
            detail: "User is not a member of this organization."
          });
          return;
        }
        if (ownerText === null) {
          ownerText = resolved.name;
        }
      }

      const treatmentResult = await client.query(
        `
        INSERT INTO risk_treatments (
          organization_id,
          risk_id,
          status,
          treatment_type,
          owner,
          owner_user_id,
          due_date,
          summary,
          notes,
          performed_at,
          reviewer_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING ${TREATMENT_SELECT}
        `,
        [
          organizationId,
          input.risk_id,
          input.status,
          input.treatment_type ?? null,
          ownerText,
          input.owner_user_id ?? null,
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

      // RR-3 fix 1.1 — without this event the treatment would appear
      // out of nowhere on the per-risk history timeline. Mirror the
      // call shape used by risks.ts for risk.created.
      writeAuditEvent({
        organizationId,
        actorApiKeyId: ((req as any).apiKey?.id as string) ?? null,
        actorUserId:   req.userId ?? null,
        eventType:     "risk_treatment.created",
        resourceType:  "risk_treatment",
        resourceId:    treatment.id as string,
        payload: {
          risk_id:        input.risk_id,
          treatment_type: input.treatment_type ?? null,
          status:         input.status,
          owner:          ownerText,
          owner_user_id:  input.owner_user_id ?? null,
          due_date:       input.due_date ?? null
        },
        ipAddress: req.ip ?? null
      });

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
  })
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
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
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
  })
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
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
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
  })
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
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
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

      // Lock the treatment row and verify org ownership. Selecting
      // TREATMENT_SELECT (rather than just id/risk_id/status) gives the
      // audit payload the BEFORE values needed to emit a per-field diff
      // when the same PATCH changes both status and metadata fields
      // (RR-3 fix 1.3).
      const treatmentResult = await client.query(
        `
        SELECT ${TREATMENT_SELECT}
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

      // Terminal-state guard — cannot modify a completed treatment.
      if (TERMINAL_STATUSES.has(existing.status)) {
        await client.query("ROLLBACK");
        res.status(409).json({
          error: "workflow_terminal",
          message: "This record is in a terminal state and cannot be modified."
        });
        return;
      }

      // Transition graph guard — must follow allowed paths.
      if (!isValidTransition(existing.status, input.status)) {
        await client.query("ROLLBACK");
        res.status(422).json({ error: "invalid_transition" });
        return;
      }

      // Build the SET clause dynamically for mutable fields.
      const setClauses: string[] = ["status = $1", "updated_at = NOW()"];
      const updateParams: unknown[] = [input.status];

      if (input.treatment_type !== undefined) {
        updateParams.push(input.treatment_type);
        setClauses.push(`treatment_type = $${updateParams.length}`);
      }

      // Owner handling: when owner_user_id is set to a real user and
      // the caller did NOT supply an explicit `owner`, denormalize the
      // resolved user's name into the text column. When owner_user_id
      // is cleared (null) the text column is left alone unless owner
      // is explicitly supplied.
      let ownerToWrite: string | null = input.owner;
      if (input.owner_user_id !== undefined && input.owner_user_id !== null) {
        const resolved = await resolveOwnerUserSameOrg(
          client,
          input.owner_user_id,
          organizationId
        );
        if ("error" in resolved) {
          await client.query("ROLLBACK");
          res.status(400).json({
            error: "invalid_owner_user_id",
            detail: "User is not a member of this organization."
          });
          return;
        }
        if (ownerToWrite === null) {
          ownerToWrite = resolved.name;
        }
      }
      if (ownerToWrite !== null) {
        updateParams.push(ownerToWrite);
        setClauses.push(`owner = $${updateParams.length}`);
      }
      if (input.owner_user_id !== undefined) {
        updateParams.push(input.owner_user_id);
        setClauses.push(`owner_user_id = $${updateParams.length}`);
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

      let riskUpdated         = false;
      let riskStatusBefore: string | null = null;
      let riskStatusAfter:  string | null = null;

      // Atomically update parent risk status when transitioning to terminal.
      if (TERMINAL_STATUSES.has(input.status)) {
        // Capture the parent risk's status BEFORE the update so the
        // RR-3 fix 1.4 audit event can record the {before, after}
        // transition. SELECT FOR UPDATE locks the parent row inside
        // the same transaction that just locked the treatment, which
        // also closes the small race window where two terminal
        // transitions on sibling treatments could clobber each other.
        const beforeRiskResult = await client.query<{ status: string }>(
          `SELECT status FROM risks
           WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
          [existing.risk_id, organizationId]
        );
        riskStatusBefore = beforeRiskResult.rows[0]?.status ?? null;

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
        riskUpdated     = true;
        riskStatusAfter = input.status;
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

      // RR-3 fix 1.3 — capture metadata changes that landed alongside
      // the status transition. Compare the BEFORE row (locked + read
      // above) against the AFTER row (RETURNING from the UPDATE). Only
      // include fields that actually changed; the `from`/`to` keys
      // already cover status separately.
      const METADATA_FIELDS = [
        "treatment_type",
        "owner",
        "owner_user_id",
        "due_date",
        "summary",
        "notes",
        "performed_at",
        "reviewer_id"
      ] as const;
      const metadata_diffs: Record<string, { before: unknown; after: unknown }> = {};
      for (const f of METADATA_FIELDS) {
        const beforeVal = (existing as Record<string, unknown>)[f] ?? null;
        const afterVal  = (treatment as Record<string, unknown>)[f] ?? null;
        if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
          metadata_diffs[f] = { before: beforeVal, after: afterVal };
        }
      }
      const hasMetadataDiffs = Object.keys(metadata_diffs).length > 0;

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId:   req.userId ?? null,
        eventType:     "workflow.status_transition",
        resourceType:  "risk_treatment",
        resourceId:    treatmentId,
        payload: {
          from:        existing.status,
          to:          input.status,
          riskUpdated,
          ...(hasMetadataDiffs ? { metadata_diffs } : {})
        },
        ipAddress: req.ip ?? null
      });

      // RR-3 fix 1.4 — when a treatment hits terminal status the parent
      // risk row's status flips inside the same transaction, but until
      // now no audit event was written for the risk itself. Result: the
      // risk's own history (filtered by resource_id=:risk_id) was missing
      // its most important transition. Emit a dedicated event so the
      // per-risk timeline shows when the risk entered terminal state and
      // which treatment caused it.
      if (riskUpdated && riskStatusBefore !== null) {
        writeAuditEvent({
          organizationId,
          actorApiKeyId: (req as any).apiKey?.id ?? null,
          actorUserId:   req.userId ?? null,
          eventType:     "risk.terminal_status",
          resourceType:  "risk",
          resourceId:    existing.risk_id as string,
          payload: {
            triggered_by_treatment_id: treatmentId,
            treatment_terminal_status: input.status,
            risk_status: { before: riskStatusBefore, after: riskStatusAfter }
          },
          ipAddress: req.ip ?? null
        });
      }

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
  })
);

export default router;
