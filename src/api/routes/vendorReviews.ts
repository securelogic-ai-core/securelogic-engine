/**
 * vendorReviews.ts — Vendor review workflow API
 *
 * A vendor review is a mutable, org-scoped workflow record that tracks an
 * ongoing or periodic review of a vendor's risk posture. It is distinct from
 * vendor_assessments (point-in-time, immutable, always creates a finding).
 *
 * FINDING CREATION RULE:
 *   A finding is created ONLY on the FIRST PATCH transition into:
 *     status = 'concerns_identified' OR status = 'critical_issues'
 *   "First" is enforced by checking whether a finding with:
 *     source_type = 'vendor_cycle_review' AND source_id = vendor_reviews.id
 *   already exists before creating a new one.
 *
 *   A 'satisfactory' review never creates a finding.
 *   No finding is created at POST.
 *
 *   Findings produced by this package use:
 *     source_type = 'vendor_cycle_review'
 *     source_id   = vendor_reviews.id  (NOT vendor_id)
 *     domain      = 'Vendor Risk'
 *
 * Routes:
 *   POST  /api/vendor-reviews        — create workflow record (no finding)
 *   GET   /api/vendor-reviews        — list for org (cursor paginated)
 *   GET   /api/vendor-reviews/:id    — get single record with finding (if exists)
 *   PATCH /api/vendor-reviews/:id    — transition status, conditionally create finding
 *
 * Constraints:
 *   - vendor_id must reference an active vendor belonging to the same org.
 *   - Archived vendors are rejected with 404.
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
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  validateVendorReviewCreate,
  validateVendorReviewStatusTransition,
  TERMINAL_STATUSES,
  FINDING_STATUSES,
  isValidTransition
} from "../lib/vendorReviewValidation.js";
import { severityToPriority } from "../lib/postureComputation.js";

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
  "satisfactory",
  "concerns_identified",
  "critical_issues"
]);

const REVIEW_SELECT = `
  id,
  organization_id,
  vendor_id,
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
   POST /api/vendor-reviews
   Create a vendor review workflow record.
   No finding is created at this step.
   ========================================================= */

router.post(
  "/vendor-reviews",
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

    const validated = validateVendorReviewCreate(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    const client = await pg.connect();
    try {
      await client.query("BEGIN");

      // Verify the vendor exists, belongs to this org, and is active.
      const vendorResult = await client.query(
        `
        SELECT id, name
        FROM vendors
        WHERE id = $1
          AND organization_id = $2
          AND status = 'active'
        FOR UPDATE
        `,
        [input.vendor_id, organizationId]
      );

      if ((vendorResult.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "vendor_not_found" });
        return;
      }

      const reviewResult = await client.query(
        `
        INSERT INTO vendor_reviews (
          organization_id,
          vendor_id,
          status,
          overall_severity,
          summary,
          notes,
          performed_at,
          reviewer_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING ${REVIEW_SELECT}
        `,
        [
          organizationId,
          input.vendor_id,
          input.status,
          input.overall_severity ?? null,
          input.summary ?? null,
          input.notes ?? null,
          input.performed_at ?? null,
          input.reviewer_id ?? null
        ]
      );

      const review = reviewResult.rows[0];

      await client.query("COMMIT");

      logger.info(
        {
          event: "vendor_review_created",
          organizationId,
          reviewId: review.id,
          vendorId: input.vendor_id,
          status: input.status
        },
        "Vendor review created"
      );

      res.status(201).json({ review });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }

      logger.error(
        { event: "vendor_review_create_failed", err },
        "POST /api/vendor-reviews failed"
      );
      res.status(500).json({ error: "vendor_review_create_failed" });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   GET /api/vendor-reviews
   List vendor reviews for the requesting organization.
   Supports cursor pagination, vendor_id filter, and status filter.
   ========================================================= */

router.get(
  "/vendor-reviews",
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

      // vendor_id filter
      const filterVendorId = isNonEmptyString(req.query.vendor_id)
        ? req.query.vendor_id.trim()
        : null;
      if (filterVendorId !== null) {
        if (!isUuid(filterVendorId)) {
          res.status(400).json({ error: "vendor_id_must_be_uuid" });
          return;
        }
        params.push(filterVendorId);
        conditions.push(`vendor_id = $${params.length}::uuid`);
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
        SELECT ${REVIEW_SELECT}
        FROM vendor_reviews
        ${whereClause}
        ORDER BY created_at DESC, id DESC
        LIMIT $${limitParam}
        `,
        params
      );

      const reviews = result.rows;
      const last = reviews.length > 0 ? reviews[reviews.length - 1] : null;

      res.status(200).json({
        count: reviews.length,
        limit,
        organizationId,
        nextCursor:
          last != null ? { created_at: last.created_at, id: last.id } : null,
        reviews
      });
    } catch (err) {
      logger.error(
        { event: "vendor_reviews_list_failed", err },
        "GET /api/vendor-reviews failed"
      );
      res.status(500).json({ error: "vendor_reviews_list_failed" });
    }
  }
);

/* =========================================================
   GET /api/vendor-reviews/:id
   Get a single vendor review with its finding (if it exists).
   Returns 404 if the review does not belong to this org.
   ========================================================= */

router.get(
  "/vendor-reviews/:id",
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

    const reviewId = String(req.params.id ?? "").trim();
    if (!reviewId) {
      res.status(400).json({ error: "review_id_required" });
      return;
    }
    if (!isUuid(reviewId)) {
      res.status(400).json({ error: "review_id_must_be_uuid" });
      return;
    }

    try {
      const reviewResult = await pg.query(
        `
        SELECT ${REVIEW_SELECT}
        FROM vendor_reviews
        WHERE id = $1
          AND organization_id = $2
        `,
        [reviewId, organizationId]
      );

      if ((reviewResult.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "vendor_review_not_found" });
        return;
      }

      const review = reviewResult.rows[0];

      const findingResult = await pg.query(
        `
        SELECT ${FINDING_SELECT}
        FROM findings
        WHERE organization_id = $1
          AND source_type = 'vendor_cycle_review'
          AND source_id = $2::uuid
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        `,
        [organizationId, reviewId]
      );

      const finding = findingResult.rows[0] ?? null;

      res.status(200).json({ review, finding });
    } catch (err) {
      logger.error(
        { event: "vendor_review_get_failed", err },
        "GET /api/vendor-reviews/:id failed"
      );
      res.status(500).json({ error: "vendor_review_get_failed" });
    }
  }
);

/* =========================================================
   PATCH /api/vendor-reviews/:id
   Transition the status of a vendor review.

   FINDING CREATION:
   - If the new status is 'concerns_identified' or 'critical_issues' AND no
     finding with source_type='vendor_cycle_review', source_id=review.id
     exists yet, a finding is created atomically with the status update.
   - If a finding already exists, no new finding is created (idempotent).
   - 'satisfactory' never creates a finding.
   - overall_severity is required when transitioning to 'concerns_identified'
     or 'critical_issues'.
   - Finding domain is 'Vendor Risk'.
   ========================================================= */

router.patch(
  "/vendor-reviews/:id",
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

    const reviewId = String(req.params.id ?? "").trim();
    if (!reviewId) {
      res.status(400).json({ error: "review_id_required" });
      return;
    }
    if (!isUuid(reviewId)) {
      res.status(400).json({ error: "review_id_must_be_uuid" });
      return;
    }

    const validated = validateVendorReviewStatusTransition(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    const client = await pg.connect();
    try {
      await client.query("BEGIN");

      // Lock the review row and verify org ownership.
      const reviewResult = await client.query(
        `
        SELECT id, vendor_id, status, overall_severity
        FROM vendor_reviews
        WHERE id = $1
          AND organization_id = $2
        FOR UPDATE
        `,
        [reviewId, organizationId]
      );

      if ((reviewResult.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "vendor_review_not_found" });
        return;
      }

      const existing = reviewResult.rows[0];

      // Terminal-state guard — cannot modify a completed review.
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

      // Resolve severity: use PATCH body if provided, else fall back to stored.
      const resolvedSeverity: string | null =
        input.overall_severity ?? existing.overall_severity ?? null;

      // Build the SET clause dynamically.
      const setClauses: string[] = ["status = $1", "updated_at = NOW()"];
      const updateParams: unknown[] = [input.status];

      setClauses.push(
        `overall_severity = COALESCE($${updateParams.length + 1}, overall_severity)`
      );
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

      updateParams.push(reviewId, organizationId);
      const idParam = updateParams.length - 1;
      const orgParam = updateParams.length;

      const updatedResult = await client.query(
        `
        UPDATE vendor_reviews
        SET ${setClauses.join(", ")}
        WHERE id = $${idParam}
          AND organization_id = $${orgParam}
        RETURNING ${REVIEW_SELECT}
        `,
        updateParams
      );

      const review = updatedResult.rows[0];

      let finding: Record<string, unknown> | null = null;

      if (FINDING_STATUSES.has(input.status)) {
        // Check whether a finding already exists for this review.
        const existingFindingResult = await client.query(
          `
          SELECT id
          FROM findings
          WHERE organization_id = $1
            AND source_type = 'vendor_cycle_review'
            AND source_id = $2::uuid
          LIMIT 1
          `,
          [organizationId, reviewId]
        );

        const findingAlreadyExists =
          (existingFindingResult.rowCount ?? 0) > 0;

        if (findingAlreadyExists) {
          // Return the existing finding for response consistency.
          const existingFetch = await client.query(
            `
            SELECT ${FINDING_SELECT}
            FROM findings
            WHERE organization_id = $1
              AND source_type = 'vendor_cycle_review'
              AND source_id = $2::uuid
            ORDER BY created_at ASC, id ASC
            LIMIT 1
            `,
            [organizationId, reviewId]
          );
          finding = existingFetch.rows[0] ?? null;
        } else if (resolvedSeverity !== null) {
          // First transition into a finding-triggering status — fetch the
          // vendor name to build a useful finding title.
          const vendorResult = await client.query(
            `SELECT name FROM vendors WHERE id = $1`,
            [existing.vendor_id]
          );

          const vendorName =
            (vendorResult.rows[0]?.name as string | undefined) ??
            "Unknown Vendor";

          const priority = severityToPriority(resolvedSeverity);
          const findingTitle = `Vendor Review: ${vendorName} — ${resolvedSeverity} severity`;
          const findingDescription =
            review.summary != null &&
            String(review.summary).trim().length > 0
              ? String(review.summary).trim()
              : `Vendor review concerns identified. Status: ${input.status}.`;

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
            VALUES ($1, NULL, 'vendor_cycle_review', $2::uuid, $3, $4, $5, 'Vendor Risk', $6, 'open')
            RETURNING ${FINDING_SELECT}
            `,
            [
              organizationId,
              reviewId,
              findingTitle,
              findingDescription,
              resolvedSeverity,
              priority
            ]
          );

          finding = findingResult.rows[0];
        } else {
          logger.warn(
            {
              event: "vendor_review_finding_skipped_no_severity",
              organizationId,
              reviewId,
              status: input.status
            },
            "Finding-triggering status transition with no resolvable severity; finding not created"
          );
        }
      }

      await client.query("COMMIT");

      logger.info(
        {
          event: "vendor_review_status_updated",
          organizationId,
          reviewId,
          status: input.status,
          findingCreated: finding !== null
        },
        "Vendor review status updated"
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        eventType: "workflow.status_transition",
        resourceType: "vendor_review",
        resourceId: reviewId,
        payload: { from: existing.status, to: input.status, findingCreated: finding !== null },
        ipAddress: req.ip ?? null
      });

      res.status(200).json({ review, finding });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }

      logger.error(
        { event: "vendor_review_patch_failed", err },
        "PATCH /api/vendor-reviews/:id failed"
      );
      res.status(500).json({ error: "vendor_review_patch_failed" });
    } finally {
      client.release();
    }
  }
);

export default router;
