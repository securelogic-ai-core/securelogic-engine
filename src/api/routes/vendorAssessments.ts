/**
 * vendorAssessments.ts — Vendor assessment workflow API
 *
 * A vendor assessment is a structured, org-scoped record representing a
 * point-in-time review of a vendor's risk posture. Creating an assessment
 * produces exactly one finding with:
 *   source_type = 'vendor_review'
 *   source_id   = vendor_assessments.id  (NOT vendor_id)
 *   domain      = 'Vendor Risk'
 *
 * This linkage convention allows GET /api/vendor-assessments/:id to return
 * the exact finding produced by the assessment via source_id equality.
 *
 * Routes:
 *   POST  /api/vendor-assessments       — create assessment + finding (transactional)
 *   GET   /api/vendor-assessments       — list assessments for org (cursor paginated)
 *   GET   /api/vendor-assessments/:id   — get single assessment with its finding
 *
 * Constraints:
 *   - Vendor must be active (status='active') at assessment creation time.
 *     Archived vendors are rejected with 404 vendor_not_found.
 *   - No hard-delete route. Assessments are immutable once created.
 *   - All routes use the standard middleware chain.
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { validateVendorAssessmentCreate } from "../lib/vendorAssessmentValidation.js";
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

const ASSESSMENT_SELECT = `
  id,
  organization_id,
  vendor_id,
  assessment_type,
  overall_severity,
  status,
  summary,
  notes,
  performed_at,
  reviewer_id,
  created_at,
  updated_at
`;

/* =========================================================
   POST /api/vendor-assessments
   Create a vendor assessment for an active vendor.
   Atomically inserts: vendor_assessments row + findings row.
   ========================================================= */

router.post(
  "/vendor-assessments",
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

    const validated = validateVendorAssessmentCreate(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    const client = await pg.connect();
    try {
      await client.query("BEGIN");

      // Lock the vendor row and verify it is active and belongs to this org.
      // FOR UPDATE prevents a concurrent PATCH status=archived from racing
      // between this check and the assessment insert.
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

      const vendorName = vendorResult.rows[0].name as string;
      const performedAt =
        input.performed_at ?? new Date().toISOString().slice(0, 10);

      // Insert the vendor assessment record.
      const assessmentResult = await client.query(
        `
        INSERT INTO vendor_assessments (
          organization_id,
          vendor_id,
          assessment_type,
          overall_severity,
          status,
          summary,
          notes,
          performed_at,
          reviewer_id
        )
        VALUES ($1, $2, $3, $4, 'completed', $5, $6, $7, $8)
        RETURNING ${ASSESSMENT_SELECT}
        `,
        [
          organizationId,
          input.vendor_id,
          input.assessment_type,
          input.overall_severity,
          input.summary ?? null,
          input.notes ?? null,
          performedAt,
          input.reviewer_id ?? null
        ]
      );

      const assessment = assessmentResult.rows[0];
      const assessmentId: string = assessment.id;

      // Insert the finding linked to this assessment.
      // source_type = 'vendor_review', source_id = assessmentId (NOT vendor_id).
      // domain = 'Vendor Risk' — hardcoded so findings feed the correct domain
      // bucket in DomainRiskAggregationEngineV2 on next posture snapshot.
      const priority = severityToPriority(input.overall_severity);
      const findingTitle = `Vendor Risk: ${vendorName} — ${input.overall_severity} severity`;
      const findingDescription =
        input.summary != null && input.summary.trim().length > 0
          ? input.summary.trim()
          : `Vendor review finding from ${input.assessment_type} assessment.`;

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
        VALUES ($1, NULL, 'vendor_review', $2::uuid, $3, $4, $5, 'Vendor Risk', $6, 'open')
        RETURNING
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
        `,
        [
          organizationId,
          assessmentId,
          findingTitle,
          findingDescription,
          input.overall_severity,
          priority
        ]
      );

      const finding = findingResult.rows[0];

      await client.query("COMMIT");

      logger.info(
        {
          event: "vendor_assessment_created",
          organizationId,
          assessmentId,
          vendorId: input.vendor_id,
          findingId: finding.id,
          overall_severity: input.overall_severity
        },
        "Vendor assessment created"
      );

      res.status(201).json({ assessment, finding });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }

      logger.error(
        { event: "vendor_assessment_create_failed", err },
        "POST /api/vendor-assessments failed"
      );
      res.status(500).json({ error: "vendor_assessment_create_failed" });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   GET /api/vendor-assessments
   List vendor assessments for the requesting organization.
   Supports cursor pagination and vendor_id filter.
   ========================================================= */

router.get(
  "/vendor-assessments",
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
        FROM vendor_assessments
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
        { event: "vendor_assessments_list_failed", err },
        "GET /api/vendor-assessments failed"
      );
      res.status(500).json({ error: "vendor_assessments_list_failed" });
    }
  }
);

/* =========================================================
   GET /api/vendor-assessments/:id
   Get a single vendor assessment with its associated finding.
   Returns 404 if the assessment does not belong to this org.

   The finding is retrieved by:
     source_type = 'vendor_review' AND source_id = assessment.id
   This is the exact finding created by POST /api/vendor-assessments.
   ========================================================= */

router.get(
  "/vendor-assessments/:id",
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
        FROM vendor_assessments
        WHERE id = $1
          AND organization_id = $2
        `,
        [assessmentId, organizationId]
      );

      if ((assessmentResult.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "vendor_assessment_not_found" });
        return;
      }

      const assessment = assessmentResult.rows[0];

      // Retrieve the finding created for this specific assessment.
      // source_id = assessment.id (not vendor_id) — exact linkage.
      const findingResult = await pg.query(
        `
        SELECT
          id,
          organization_id,
          assessment_id,
          source_type,
          source_id,
          title,
          description,
          severity,
          recommendation,
          domain,
          priority,
          status,
          owner_user_id,
          created_at,
          updated_at
        FROM findings
        WHERE organization_id = $1
          AND source_type = 'vendor_review'
          AND source_id = $2::uuid
        ORDER BY created_at DESC, id DESC
        `,
        [organizationId, assessmentId]
      );

      const finding = findingResult.rows[0] ?? null;

      res.status(200).json({ assessment, finding });
    } catch (err) {
      logger.error(
        { event: "vendor_assessment_get_failed", err },
        "GET /api/vendor-assessments/:id failed"
      );
      res.status(500).json({ error: "vendor_assessment_get_failed" });
    }
  }
);

export default router;