/**
 * controlAssessments.ts — Control assessment workflow API
 *
 * A control assessment is a mutable, org-scoped workflow record that tracks
 * the lifecycle of a control test. It is created with no finding.
 *
 * FINDING CREATION RULE:
 *   A finding is created ONLY on the FIRST PATCH transition into:
 *     status = 'failed' OR status = 'remediation_required'
 *   "First" is enforced by checking whether a finding with:
 *     source_type = 'control_test' AND source_id = control_assessments.id
 *   already exists before creating a new one.
 *
 *   A 'passed' assessment never creates a finding.
 *   No finding is created at POST.
 *
 *   Findings produced by this package use:
 *     source_type = 'control_test'
 *     source_id   = control_assessments.id  (NOT control_id)
 *     domain      = 'General'
 *
 * Routes:
 *   POST  /api/control-assessments        — create workflow record (no finding)
 *   GET   /api/control-assessments        — list for org (cursor paginated)
 *   GET   /api/control-assessments/:id    — get single record with finding (if exists)
 *   PATCH /api/control-assessments/:id    — transition status, conditionally create finding
 *
 * Constraints:
 *   - control_id must reference a control belonging to the same org.
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
  validateControlAssessmentCreate,
  validateControlAssessmentStatusTransition,
  FINDING_STATUSES
} from "../lib/controlAssessmentValidation.js";
import { severityToPriority } from "../lib/postureComputation.js";
import { writeAuditEvent } from "../lib/auditLog.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

const ASSESSMENT_SELECT = `
  id,
  organization_id,
  control_id,
  status,
  overall_severity,
  summary,
  notes,
  performed_at,
  reviewer_id,
  created_at,
  updated_at
`;

const FINDING_SELECT = `
  id,
  organization_id,
  assessment_id,
  source_type,
  source_id,
  title,
  description,
  severity,
  domain,
  priority,
  status,
  created_at,
  updated_at
`;

/* =========================================================
   POST /api/control-assessments
   Create a control assessment workflow record.
   No finding is created at this step.
   ========================================================= */

router.post(
  "/control-assessments",
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

    const validated = validateControlAssessmentCreate(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    const client = await pg.connect();
    try {
      await client.query("BEGIN");

      // Verify that the control exists and belongs to this org.
      // FOR UPDATE prevents a concurrent delete from racing between
      // this check and the assessment insert.
      const controlResult = await client.query(
        `
        SELECT id, name
        FROM controls
        WHERE id = $1
          AND organization_id = $2
        FOR UPDATE
        `,
        [input.control_id, organizationId]
      );

      if ((controlResult.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "control_not_found" });
        return;
      }

      const assessmentResult = await client.query(
        `
        INSERT INTO control_assessments (
          organization_id,
          control_id,
          status,
          overall_severity,
          summary,
          notes,
          performed_at,
          reviewer_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING ${ASSESSMENT_SELECT}
        `,
        [
          organizationId,
          input.control_id,
          input.status,
          input.overall_severity ?? null,
          input.summary ?? null,
          input.notes ?? null,
          input.performed_at ?? null,
          input.reviewer_id ?? null
        ]
      );

      const assessment = assessmentResult.rows[0];

      await client.query("COMMIT");

      logger.info(
        {
          event: "control_assessment_created",
          organizationId,
          assessmentId: assessment.id,
          controlId: input.control_id,
          status: input.status
        },
        "Control assessment created"
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId: req.userId ?? null,
        eventType: "control_assessment.created",
        resourceType: "control_assessment",
        resourceId: assessment.id as string,
        payload: { control_id: input.control_id, status: input.status },
        ipAddress: req.ip ?? null
      });

      res.status(201).json({ assessment });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }

      logger.error(
        { event: "control_assessment_create_failed", err },
        "POST /api/control-assessments failed"
      );
      res.status(500).json({ error: "control_assessment_create_failed" });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   GET /api/control-assessments
   List control assessments for the requesting organization.
   Supports cursor pagination and control_id filter.
   ========================================================= */

router.get(
  "/control-assessments",
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

      const filterControlId = isNonEmptyString(req.query.control_id)
        ? req.query.control_id.trim()
        : null;
      if (filterControlId !== null) {
        if (!isUuid(filterControlId)) {
          res.status(400).json({ error: "control_id_must_be_uuid" });
          return;
        }
        params.push(filterControlId);
        conditions.push(`control_id = $${params.length}::uuid`);
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
        SELECT ${ASSESSMENT_SELECT}
        FROM control_assessments
        ${whereClause}
        ORDER BY created_at DESC, id DESC
        LIMIT $${limitParam}
        `,
        params
      );

      const assessments = result.rows;
      const last =
        assessments.length > 0 ? assessments[assessments.length - 1] : null;

      res.status(200).json({
        count: assessments.length,
        limit,
        organizationId,
        nextCursor:
          last != null ? { created_at: last.created_at, id: last.id } : null,
        assessments
      });
    } catch (err) {
      logger.error(
        { event: "control_assessments_list_failed", err },
        "GET /api/control-assessments failed"
      );
      res.status(500).json({ error: "control_assessments_list_failed" });
    }
  }
);

/* =========================================================
   GET /api/control-assessments/:id
   Get a single control assessment with its finding (if it exists).
   Returns 404 if the assessment does not belong to this org.

   The finding is retrieved by:
     source_type = 'control_test' AND source_id = assessment.id
   ========================================================= */

router.get(
  "/control-assessments/:id",
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

    const assessmentId = String(req.params.id ?? "").trim();
    if (!assessmentId) {
      res.status(400).json({ error: "assessment_id_required" });
      return;
    }
    if (!isUuid(assessmentId)) {
      res.status(400).json({ error: "assessment_id_must_be_uuid" });
      return;
    }

    try {
      const assessmentResult = await pg.query(
        `
        SELECT ${ASSESSMENT_SELECT}
        FROM control_assessments
        WHERE id = $1
          AND organization_id = $2
        `,
        [assessmentId, organizationId]
      );

      if ((assessmentResult.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "control_assessment_not_found" });
        return;
      }

      const assessment = assessmentResult.rows[0];

      // Retrieve the finding created for this assessment, if it exists.
      // source_id = assessment.id (not control_id) — exact linkage.
      const findingResult = await pg.query(
        `
        SELECT ${FINDING_SELECT}
        FROM findings
        WHERE organization_id = $1
          AND source_type = 'control_test'
          AND source_id = $2::uuid
        ORDER BY created_at DESC, id DESC
        `,
        [organizationId, assessmentId]
      );

      const finding = findingResult.rows[0] ?? null;

      res.status(200).json({ assessment, finding });
    } catch (err) {
      logger.error(
        { event: "control_assessment_get_failed", err },
        "GET /api/control-assessments/:id failed"
      );
      res.status(500).json({ error: "control_assessment_get_failed" });
    }
  }
);

/* =========================================================
   PATCH /api/control-assessments/:id
   Transition the status of a control assessment.

   FINDING CREATION:
   - If the new status is 'failed' or 'remediation_required' AND no finding
     with source_type='control_test', source_id=assessment.id exists yet,
     a finding is created atomically with the status update.
   - If a finding already exists, no new finding is created (idempotent).
   - 'passed' never creates a finding.
   - overall_severity is required when transitioning to 'failed' or
     'remediation_required'.
   ========================================================= */

router.patch(
  "/control-assessments/:id",
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

    const assessmentId = String(req.params.id ?? "").trim();
    if (!assessmentId) {
      res.status(400).json({ error: "assessment_id_required" });
      return;
    }
    if (!isUuid(assessmentId)) {
      res.status(400).json({ error: "assessment_id_must_be_uuid" });
      return;
    }

    const validated = validateControlAssessmentStatusTransition(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    const client = await pg.connect();
    try {
      await client.query("BEGIN");

      // Lock the assessment row and verify org ownership.
      const assessmentResult = await client.query(
        `
        SELECT id, control_id, status, overall_severity
        FROM control_assessments
        WHERE id = $1
          AND organization_id = $2
        FOR UPDATE
        `,
        [assessmentId, organizationId]
      );

      if ((assessmentResult.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "control_assessment_not_found" });
        return;
      }

      const existing = assessmentResult.rows[0];

      // Resolve overall_severity: use the value from the PATCH body if
      // provided, otherwise fall back to the value already stored on the record.
      const resolvedSeverity: string | null =
        input.overall_severity ?? existing.overall_severity ?? null;

      // Update the assessment status (and overall_severity if provided).
      const updatedResult = await client.query(
        `
        UPDATE control_assessments
        SET
          status           = $1,
          overall_severity = COALESCE($2, overall_severity),
          updated_at       = NOW()
        WHERE id = $3
          AND organization_id = $4
        RETURNING ${ASSESSMENT_SELECT}
        `,
        [input.status, input.overall_severity ?? null, assessmentId, organizationId]
      );

      const assessment = updatedResult.rows[0];

      let finding: Record<string, unknown> | null = null;

      // Conditionally create a finding on the first transition into a
      // finding-triggering status.
      if (FINDING_STATUSES.has(input.status)) {
        // Check whether a finding already exists for this assessment.
        const existingFindingResult = await client.query(
          `
          SELECT id
          FROM findings
          WHERE organization_id = $1
            AND source_type = 'control_test'
            AND source_id = $2::uuid
          LIMIT 1
          `,
          [organizationId, assessmentId]
        );

        const findingAlreadyExists =
          (existingFindingResult.rowCount ?? 0) > 0;

        if (findingAlreadyExists) {
          // Finding already exists from a prior transition — do not create a
          // second one. Return the existing finding so the PATCH response is
          // consistent with GET :id (which always returns the finding if present).
          const existingFindingFetchResult = await client.query(
            `
            SELECT ${FINDING_SELECT}
            FROM findings
            WHERE organization_id = $1
              AND source_type = 'control_test'
              AND source_id = $2::uuid
            ORDER BY created_at ASC, id ASC
            LIMIT 1
            `,
            [organizationId, assessmentId]
          );
          finding = existingFindingFetchResult.rows[0] ?? null;
        } else if (resolvedSeverity !== null) {
          // First transition into a finding-triggering status — create finding.

          // Retrieve the control name for a descriptive finding title.
          const controlResult = await client.query(
            `
            SELECT name
            FROM controls
            WHERE id = $1
            `,
            [existing.control_id]
          );

          const controlName =
            (controlResult.rows[0]?.name as string | undefined) ?? "Unknown Control";

          const priority = severityToPriority(resolvedSeverity);
          const findingTitle = `Control Test: ${controlName} — ${resolvedSeverity} severity`;
          const findingDescription =
            assessment.summary != null &&
            String(assessment.summary).trim().length > 0
              ? String(assessment.summary).trim()
              : `Control test finding. Status: ${input.status}.`;

          const findingResult = await client.query(
            `
            INSERT INTO findings (
              organization_id,
              assessment_id,
              source_type,
              source_id,
              title,
              description,
              severity,
              domain,
              priority,
              status
            )
            VALUES ($1, NULL, 'control_test', $2::uuid, $3, $4, $5, 'General', $6, 'open')
            RETURNING ${FINDING_SELECT}
            `,
            [
              organizationId,
              assessmentId,
              findingTitle,
              findingDescription,
              resolvedSeverity,
              priority
            ]
          );

          finding = findingResult.rows[0];
        } else {
          // No finding created: severity not resolvable.
          // This should not happen — validation enforces overall_severity when
          // transitioning to a finding-triggering status. Log and continue
          // without creating a finding rather than aborting the status update.
          logger.warn(
            {
              event: "control_assessment_finding_skipped_no_severity",
              organizationId,
              assessmentId,
              status: input.status
            },
            "Finding-triggering status transition with no resolvable severity; finding not created"
          );
        }
      }

      // When transitioning to 'passed', update the parent control's
      // last_tested_at and next_test_due based on its testing_frequency.
      if (input.status === "passed") {
        const freqRow = await client.query<{ testing_frequency: string | null }>(
          `SELECT testing_frequency FROM controls WHERE id = $1`,
          [existing.control_id]
        );

        const freq = freqRow.rows[0]?.testing_frequency ?? null;
        const performedAt = (assessment.performed_at as string | null) ?? null;

        const CADENCE_DAYS: Record<string, number> = {
          monthly: 30, quarterly: 90, biannual: 180, annual: 365,
        };

        if (freq !== null && freq !== "ad_hoc" && freq in CADENCE_DAYS) {
          const days = CADENCE_DAYS[freq]!;
          await client.query(
            `UPDATE controls
             SET last_tested_at = COALESCE($3::date, CURRENT_DATE),
                 next_test_due   = COALESCE($3::date, CURRENT_DATE) + ($4 * INTERVAL '1 day'),
                 updated_at      = NOW()
             WHERE id = $1 AND organization_id = $2`,
            [existing.control_id, organizationId, performedAt, days]
          );
        } else if (freq !== null) {
          // ad_hoc: record last_tested_at but leave next_test_due null
          await client.query(
            `UPDATE controls
             SET last_tested_at = COALESCE($3::date, CURRENT_DATE),
                 updated_at      = NOW()
             WHERE id = $1 AND organization_id = $2`,
            [existing.control_id, organizationId, performedAt]
          );
        }
      }

      await client.query("COMMIT");

      logger.info(
        {
          event: "control_assessment_status_updated",
          organizationId,
          assessmentId,
          status: input.status,
          findingCreated: finding !== null
        },
        "Control assessment status updated"
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId: req.userId ?? null,
        eventType: "control_assessment.updated",
        resourceType: "control_assessment",
        resourceId: assessmentId,
        payload: { fields: Object.keys(input) },
        ipAddress: req.ip ?? null
      });

      res.status(200).json({ assessment, finding });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }

      logger.error(
        { event: "control_assessment_patch_failed", err },
        "PATCH /api/control-assessments/:id failed"
      );
      res.status(500).json({ error: "control_assessment_patch_failed" });
    } finally {
      client.release();
    }
  }
);

export default router;
