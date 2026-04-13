/**
 * obligationAssessments.ts — Obligation assessment workflow API
 *
 * An obligation assessment is a mutable, org-scoped workflow record that tracks
 * whether an obligation is being met. It is created with no finding.
 *
 * FINDING CREATION RULE:
 *   A finding is created ONLY on the FIRST PATCH transition into:
 *     status = 'non_compliant' OR status = 'partially_compliant'
 *   "First" is enforced by checking whether a finding with:
 *     source_type = 'obligation_review' AND source_id = obligation_assessments.id
 *   already exists before creating a new one.
 *
 *   A 'compliant' assessment never creates a finding.
 *   No finding is created at POST.
 *
 *   Findings produced by this package use:
 *     source_type = 'obligation_review'
 *     source_id   = obligation_assessments.id  (NOT obligation_id)
 *     domain      = obligation.domain (inherited from the parent obligation)
 *
 * Routes:
 *   POST  /api/obligation-assessments        — create workflow record (no finding)
 *   GET   /api/obligation-assessments        — list for org (cursor paginated)
 *   GET   /api/obligation-assessments/:id    — get single record with finding (if exists)
 *   PATCH /api/obligation-assessments/:id    — transition status, conditionally create finding
 *
 * Constraints:
 *   - obligation_id must reference an obligation belonging to the same org.
 *   - Obligation must be status='active' at POST creation time.
 *     Waived or not_applicable obligations are rejected with 404.
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
  validateObligationAssessmentCreate,
  validateObligationAssessmentStatusTransition,
  FINDING_STATUSES
} from "../lib/obligationAssessmentValidation.js";
import { severityToPriority } from "../lib/postureComputation.js";

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

const VALID_STATUS_FILTERS = new Set([
  "not_started",
  "in_progress",
  "compliant",
  "non_compliant",
  "partially_compliant"
]);

const ASSESSMENT_SELECT = `
  id,
  organization_id,
  obligation_id,
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
   POST /api/obligation-assessments
   Create an obligation assessment workflow record.
   No finding is created at this step.
   ========================================================= */

router.post(
  "/obligation-assessments",
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

    const validated = validateObligationAssessmentCreate(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    const client = await pg.connect();
    try {
      await client.query("BEGIN");

      // Verify that the obligation exists, belongs to this org, and is active.
      // FOR UPDATE prevents a concurrent PATCH status=waived from racing between
      // this check and the assessment insert.
      const obligationResult = await client.query(
        `
        SELECT id, title, status
        FROM obligations
        WHERE id = $1
          AND organization_id = $2
        FOR UPDATE
        `,
        [input.obligation_id, organizationId]
      );

      if ((obligationResult.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "obligation_not_found" });
        return;
      }

      const obligation = obligationResult.rows[0];

      if (obligation.status !== "active") {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "obligation_not_found" });
        return;
      }

      const assessmentResult = await client.query(
        `
        INSERT INTO obligation_assessments (
          organization_id,
          obligation_id,
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
          input.obligation_id,
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
          event: "obligation_assessment_created",
          organizationId,
          assessmentId: assessment.id,
          obligationId: input.obligation_id,
          status: input.status
        },
        "Obligation assessment created"
      );

      res.status(201).json({ assessment });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }

      logger.error(
        { event: "obligation_assessment_create_failed", err },
        "POST /api/obligation-assessments failed"
      );
      res.status(500).json({ error: "obligation_assessment_create_failed" });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   GET /api/obligation-assessments
   List obligation assessments for the requesting organization.
   Supports cursor pagination, obligation_id filter, and status filter.
   ========================================================= */

router.get(
  "/obligation-assessments",
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

      // obligation_id filter
      const filterObligationId = isNonEmptyString(req.query.obligation_id)
        ? req.query.obligation_id.trim()
        : null;
      if (filterObligationId !== null) {
        if (!isUuid(filterObligationId)) {
          res.status(400).json({ error: "obligation_id_must_be_uuid" });
          return;
        }
        params.push(filterObligationId);
        conditions.push(`obligation_id = $${params.length}::uuid`);
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
        SELECT ${ASSESSMENT_SELECT}
        FROM obligation_assessments
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
        { event: "obligation_assessments_list_failed", err },
        "GET /api/obligation-assessments failed"
      );
      res.status(500).json({ error: "obligation_assessments_list_failed" });
    }
  }
);

/* =========================================================
   GET /api/obligation-assessments/:id
   Get a single obligation assessment with its finding (if it exists).
   Returns 404 if the assessment does not belong to this org.

   The finding is retrieved by:
     source_type = 'obligation_review' AND source_id = assessment.id
   ========================================================= */

router.get(
  "/obligation-assessments/:id",
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
        FROM obligation_assessments
        WHERE id = $1
          AND organization_id = $2
        `,
        [assessmentId, organizationId]
      );

      if ((assessmentResult.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "obligation_assessment_not_found" });
        return;
      }

      const assessment = assessmentResult.rows[0];

      // Retrieve the finding created for this assessment, if it exists.
      // source_id = assessment.id (not obligation_id) — exact linkage.
      const findingResult = await pg.query(
        `
        SELECT ${FINDING_SELECT}
        FROM findings
        WHERE organization_id = $1
          AND source_type = 'obligation_review'
          AND source_id = $2::uuid
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        `,
        [organizationId, assessmentId]
      );

      const finding = findingResult.rows[0] ?? null;

      res.status(200).json({ assessment, finding });
    } catch (err) {
      logger.error(
        { event: "obligation_assessment_get_failed", err },
        "GET /api/obligation-assessments/:id failed"
      );
      res.status(500).json({ error: "obligation_assessment_get_failed" });
    }
  }
);

/* =========================================================
   PATCH /api/obligation-assessments/:id
   Transition the status of an obligation assessment.

   FINDING CREATION:
   - If the new status is 'non_compliant' or 'partially_compliant' AND no finding
     with source_type='obligation_review', source_id=assessment.id exists yet,
     a finding is created atomically with the status update.
   - If a finding already exists, no new finding is created (idempotent).
   - 'compliant' never creates a finding.
   - overall_severity is required when transitioning to 'non_compliant' or
     'partially_compliant'.
   - Finding domain is inherited from the parent obligation's domain field.
   ========================================================= */

router.patch(
  "/obligation-assessments/:id",
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

    const validated = validateObligationAssessmentStatusTransition(req.body);
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
        SELECT id, obligation_id, status, overall_severity
        FROM obligation_assessments
        WHERE id = $1
          AND organization_id = $2
        FOR UPDATE
        `,
        [assessmentId, organizationId]
      );

      if ((assessmentResult.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "obligation_assessment_not_found" });
        return;
      }

      const existing = assessmentResult.rows[0];

      // Resolve overall_severity: use the value from the PATCH body if
      // provided, otherwise fall back to the value already stored on the record.
      const resolvedSeverity: string | null =
        input.overall_severity ?? existing.overall_severity ?? null;

      // Build the SET clause dynamically for mutable fields.
      const setClauses: string[] = ["status = $1", "updated_at = NOW()"];
      const updateParams: unknown[] = [input.status];

      setClauses.push(`overall_severity = COALESCE($${updateParams.length + 1}, overall_severity)`);
      updateParams.push(input.overall_severity ?? null);

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

      updateParams.push(assessmentId, organizationId);
      const idParam = updateParams.length - 1;
      const orgParam = updateParams.length;

      const updatedResult = await client.query(
        `
        UPDATE obligation_assessments
        SET ${setClauses.join(", ")}
        WHERE id = $${idParam}
          AND organization_id = $${orgParam}
        RETURNING ${ASSESSMENT_SELECT}
        `,
        updateParams
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
            AND source_type = 'obligation_review'
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
          // consistent with GET :id.
          const existingFindingFetchResult = await client.query(
            `
            SELECT ${FINDING_SELECT}
            FROM findings
            WHERE organization_id = $1
              AND source_type = 'obligation_review'
              AND source_id = $2::uuid
            ORDER BY created_at ASC, id ASC
            LIMIT 1
            `,
            [organizationId, assessmentId]
          );
          finding = existingFindingFetchResult.rows[0] ?? null;
        } else if (resolvedSeverity !== null) {
          // First transition into a finding-triggering status — create finding.
          // Fetch the obligation to get its title and domain.
          const obligationResult = await client.query(
            `
            SELECT title, domain
            FROM obligations
            WHERE id = $1
            `,
            [existing.obligation_id]
          );

          const obligationTitle =
            (obligationResult.rows[0]?.title as string | undefined) ?? "Unknown Obligation";
          const obligationDomain =
            (obligationResult.rows[0]?.domain as string | undefined) ?? "General";

          const priority = severityToPriority(resolvedSeverity);
          const findingTitle = `Obligation Gap: ${obligationTitle} — ${resolvedSeverity} severity`;
          const findingDescription =
            assessment.summary != null &&
            String(assessment.summary).trim().length > 0
              ? String(assessment.summary).trim()
              : `Obligation compliance gap. Status: ${input.status}.`;

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
            VALUES ($1, NULL, 'obligation_review', $2::uuid, $3, $4, $5, $6, $7, 'open')
            RETURNING ${FINDING_SELECT}
            `,
            [
              organizationId,
              assessmentId,
              findingTitle,
              findingDescription,
              resolvedSeverity,
              obligationDomain,
              priority
            ]
          );

          finding = findingResult.rows[0];
        } else {
          // No finding created: severity not resolvable.
          // Validation enforces overall_severity when transitioning to finding-
          // triggering statuses, so this branch should not be reached in normal
          // operation. Log and continue rather than aborting the status update.
          logger.warn(
            {
              event: "obligation_assessment_finding_skipped_no_severity",
              organizationId,
              assessmentId,
              status: input.status
            },
            "Finding-triggering status transition with no resolvable severity; finding not created"
          );
        }
      }

      await client.query("COMMIT");

      logger.info(
        {
          event: "obligation_assessment_status_updated",
          organizationId,
          assessmentId,
          status: input.status,
          findingCreated: finding !== null
        },
        "Obligation assessment status updated"
      );

      res.status(200).json({ assessment, finding });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }

      logger.error(
        { event: "obligation_assessment_patch_failed", err },
        "PATCH /api/obligation-assessments/:id failed"
      );
      res.status(500).json({ error: "obligation_assessment_patch_failed" });
    } finally {
      client.release();
    }
  }
);

export default router;
