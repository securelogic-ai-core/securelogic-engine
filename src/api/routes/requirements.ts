/**
 * requirements.ts — Framework requirement primitives API
 *
 * Requirements are individual entries within a compliance framework
 * (e.g. "ID.AM-1" in NIST CSF 2.0). They belong to a framework and inherit
 * org scope through it — requirements have no direct organization_id column.
 *
 * Org isolation is enforced by joining requirements → frameworks and
 * verifying frameworks.organization_id matches the requesting org on
 * every route that creates or reads requirements.
 *
 * Routes:
 *   POST  /api/requirements       — create requirement under a framework
 *   GET   /api/requirements       — list requirements (?framework_id required)
 *   GET   /api/requirements/:id   — get single requirement
 *
 * No PATCH. No DELETE. Requirements are reference data in this package.
 * All routes use the standard middleware chain.
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { validateRequirementCreate } from "../lib/requirementValidation.js";
import { validateRequirementResponseUpsert } from "../lib/requirementResponseValidation.js";
import { writeAuditEvent } from "../lib/auditLog.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function parseLimit(value: unknown): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

const REQUIREMENT_SELECT = `
  r.id,
  r.framework_id,
  r.reference_id,
  r.title,
  r.created_at
`;

/* =========================================================
   POST /api/requirements
   Create a requirement under a framework.
   The framework must belong to the requesting organization.
   ========================================================= */

router.post(
  "/requirements",
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

    const validated = validateRequirementCreate(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    const client = await pg.connect();
    try {
      await client.query("BEGIN");

      // Verify the framework exists and belongs to this org.
      // Requirements inherit org scope through their framework.
      const frameworkResult = await client.query(
        `
        SELECT id
        FROM frameworks
        WHERE id = $1
          AND organization_id = $2
        FOR UPDATE
        `,
        [input.framework_id, organizationId]
      );

      if ((frameworkResult.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "framework_not_found" });
        return;
      }

      let result;
      try {
        result = await client.query(
          `
          INSERT INTO requirements (framework_id, reference_id, title)
          VALUES ($1, $2, $3)
          RETURNING
            id,
            framework_id,
            reference_id,
            title,
            created_at
          `,
          [input.framework_id, input.reference_id, input.title]
        );
      } catch (err: any) {
        await client.query("ROLLBACK");
        if (err?.code === "23505") {
          res.status(409).json({
            error: "requirement_already_exists",
            detail: `A requirement with reference_id "${input.reference_id}" already exists in this framework.`
          });
          return;
        }
        throw err;
      }

      await client.query("COMMIT");

      logger.info(
        {
          event: "requirement_created",
          organizationId,
          frameworkId: input.framework_id,
          requirementId: result.rows[0]?.id,
          reference_id: input.reference_id
        },
        "Requirement created"
      );

      res.status(201).json({ requirement: result.rows[0] });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }

      logger.error(
        { event: "requirement_create_failed", err },
        "POST /api/requirements failed"
      );
      res.status(500).json({ error: "requirement_create_failed" });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   GET /api/requirements
   List requirements for a framework.
   ?framework_id=<uuid> is required.
   The framework must belong to the requesting organization.
   Supports cursor pagination.
   ========================================================= */

router.get(
  "/requirements",
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

    // framework_id filter is required — requirements are always scoped to a framework
    const filterFrameworkId = isNonEmptyString(req.query.framework_id)
      ? req.query.framework_id.trim()
      : null;

    if (filterFrameworkId === null) {
      res.status(400).json({ error: "framework_id_required" });
      return;
    }
    if (!isUuid(filterFrameworkId)) {
      res.status(400).json({ error: "framework_id_must_be_uuid" });
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

      // Verify the framework belongs to this org before returning its requirements.
      const frameworkResult = await pg.query(
        `
        SELECT id
        FROM frameworks
        WHERE id = $1
          AND organization_id = $2
        `,
        [filterFrameworkId, organizationId]
      );

      if ((frameworkResult.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "framework_not_found" });
        return;
      }

      const conditions: string[] = ["r.framework_id = $1"];
      const params: unknown[] = [filterFrameworkId];

      if (useCursor) {
        if (!isUuid(beforeId)) {
          res.status(400).json({ error: "before_id_must_be_uuid" });
          return;
        }
        params.push(beforeCreatedAt, beforeId);
        const ci = params.length - 1;
        conditions.push(
          `(r.created_at, r.id) < ($${ci}::timestamptz, $${ci + 1}::uuid)`
        );
      }

      params.push(limit);
      const limitParam = params.length;

      const result = await pg.query(
        `
        SELECT ${REQUIREMENT_SELECT}
        FROM requirements r
        WHERE ${conditions.join(" AND ")}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT $${limitParam}
        `,
        params
      );

      const requirements = result.rows;
      const last =
        requirements.length > 0 ? requirements[requirements.length - 1] : null;

      res.status(200).json({
        count: requirements.length,
        limit,
        frameworkId: filterFrameworkId,
        nextCursor:
          last != null ? { created_at: last.created_at, id: last.id } : null,
        requirements
      });
    } catch (err) {
      logger.error(
        { event: "requirements_list_failed", err },
        "GET /api/requirements failed"
      );
      res.status(500).json({ error: "requirements_list_failed" });
    }
  }
);

/* =========================================================
   GET /api/requirements/:id
   Get a single requirement.
   Org isolation enforced via join through framework.
   Returns 404 if not found or if the requirement's framework
   belongs to a different organization.
   ========================================================= */

router.get(
  "/requirements/:id",
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

    const requirementId = String(req.params["id"] ?? "").trim();
    if (!requirementId) {
      res.status(400).json({ error: "requirement_id_required" });
      return;
    }
    if (!isUuid(requirementId)) {
      res.status(400).json({ error: "requirement_id_must_be_uuid" });
      return;
    }

    try {
      // Join through frameworks to enforce org scope.
      // requirements has no organization_id — isolation is via framework ownership.
      const result = await pg.query(
        `
        SELECT ${REQUIREMENT_SELECT}
        FROM requirements r
        JOIN frameworks f ON f.id = r.framework_id
        WHERE r.id = $1
          AND f.organization_id = $2
        `,
        [requirementId, organizationId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "requirement_not_found" });
        return;
      }

      res.status(200).json({ requirement: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "requirement_get_failed", err },
        "GET /api/requirements/:id failed"
      );
      res.status(500).json({ error: "requirement_get_failed" });
    }
  }
);

/* =========================================================
   GET /api/frameworks/:id/requirements
   Returns all requirements for a framework with the current
   response status for the requesting org and subject.

   Query params:
     - assessment_type: 'self' | 'vendor' (required)
     - subject_id: uuid (required for vendor; defaults to org_id for self)

   Response includes per-requirement response (or null) and a
   summary with readiness_score = (pass + partial * 0.5) / total.
   ========================================================= */

router.get(
  "/frameworks/:id/requirements",
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

    const frameworkId = String(req.params["id"] ?? "").trim();
    if (!frameworkId) {
      res.status(400).json({ error: "framework_id_required" });
      return;
    }
    if (!isUuid(frameworkId)) {
      res.status(400).json({ error: "framework_id_must_be_uuid" });
      return;
    }

    const assessmentType = isNonEmptyString(req.query.assessment_type)
      ? (req.query.assessment_type as string).trim()
      : null;
    if (!assessmentType) {
      res.status(400).json({ error: "assessment_type_required" });
      return;
    }
    if (assessmentType !== "self" && assessmentType !== "vendor") {
      res.status(400).json({
        error: "invalid_assessment_type",
        detail: "Must be one of: self, vendor"
      });
      return;
    }

    // subject_id: defaults to org_id for self, required for vendor
    let subjectId: string;
    if (assessmentType === "self") {
      subjectId = isNonEmptyString(req.query.subject_id)
        ? (req.query.subject_id as string).trim()
        : organizationId;
    } else {
      const rawSubjectId = isNonEmptyString(req.query.subject_id)
        ? (req.query.subject_id as string).trim()
        : null;
      if (!rawSubjectId) {
        res.status(400).json({ error: "subject_id_required_for_vendor" });
        return;
      }
      if (!isUuid(rawSubjectId)) {
        res.status(400).json({ error: "subject_id_must_be_uuid" });
        return;
      }
      subjectId = rawSubjectId;
    }

    try {
      // Verify the framework belongs to this org
      const frameworkResult = await pg.query<{
        id: string; name: string; version: string;
      }>(
        `SELECT id, name, version FROM frameworks WHERE id = $1 AND organization_id = $2`,
        [frameworkId, organizationId]
      );

      if ((frameworkResult.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "framework_not_found" });
        return;
      }

      const framework = frameworkResult.rows[0]!;

      // Fetch all requirements with LEFT JOIN on responses for this subject
      const result = await pg.query<{
        id: string;
        reference_id: string;
        title: string;
        response_id: string | null;
        response_status: string | null;
        response_notes: string | null;
        response_evidence_url: string | null;
        response_assessed_at: string | null;
      }>(
        `
        SELECT
          r.id,
          r.reference_id,
          r.title,
          rr.id             AS response_id,
          rr.status         AS response_status,
          rr.notes          AS response_notes,
          rr.evidence_url   AS response_evidence_url,
          rr.assessed_at    AS response_assessed_at
        FROM requirements r
        LEFT JOIN requirement_responses rr
          ON rr.requirement_id = r.id
         AND rr.organization_id = $1
         AND rr.assessment_type = $2
         AND rr.subject_id       = $3::uuid
        WHERE r.framework_id = $4
        ORDER BY r.created_at ASC, r.id ASC
        `,
        [organizationId, assessmentType, subjectId, frameworkId]
      );

      const requirements = result.rows;
      const total = requirements.length;

      let pass = 0;
      let partial = 0;
      let fail = 0;
      let not_assessed = 0;

      const requirementList = requirements.map((row) => {
        const hasResponse = row.response_id !== null;
        if (!hasResponse || row.response_status === "not_assessed") {
          not_assessed++;
        } else if (row.response_status === "pass") {
          pass++;
        } else if (row.response_status === "partial") {
          partial++;
        } else if (row.response_status === "fail") {
          fail++;
        }

        return {
          id: row.id,
          reference_id: row.reference_id,
          title: row.title,
          response: hasResponse
            ? {
                status: row.response_status,
                notes: row.response_notes ?? null,
                evidence_url: row.response_evidence_url ?? null,
                assessed_at: row.response_assessed_at ?? null
              }
            : null
        };
      });

      const readiness_score =
        total === 0 ? 0 : (pass + partial * 0.5) / total;

      res.status(200).json({
        framework: { id: framework.id, name: framework.name, version: framework.version },
        requirements: requirementList,
        summary: {
          total,
          pass,
          partial,
          fail,
          not_assessed,
          readiness_score: Math.round(readiness_score * 10000) / 10000
        }
      });
    } catch (err) {
      logger.error(
        { event: "framework_requirements_list_failed", err },
        "GET /api/frameworks/:id/requirements failed"
      );
      res.status(500).json({ error: "framework_requirements_list_failed" });
    }
  }
);

/* =========================================================
   POST /api/requirement-responses
   Upsert a single requirement response.

   Uses INSERT ... ON CONFLICT DO UPDATE.
   Semantic validation:
     - requirement_id must belong to a framework owned by this org
     - if self: subject_id must equal organization_id
     - if vendor: subject_id must be a valid vendor_id for this org
   ========================================================= */

router.post(
  "/requirement-responses",
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

    const validated = validateRequirementResponseUpsert(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    try {
      // Verify requirement_id belongs to a framework owned by this org
      const requirementCheck = await pg.query(
        `
        SELECT r.id
        FROM requirements r
        JOIN frameworks f ON f.id = r.framework_id
        WHERE r.id = $1
          AND f.organization_id = $2
        `,
        [input.requirement_id, organizationId]
      );

      if ((requirementCheck.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "requirement_not_found" });
        return;
      }

      // Semantic subject_id validation
      if (input.assessment_type === "self") {
        if (input.subject_id !== organizationId) {
          res.status(400).json({
            error: "subject_id_must_equal_organization_id_for_self_assessment"
          });
          return;
        }
      } else {
        // vendor: subject_id must be an active vendor belonging to this org
        const vendorCheck = await pg.query(
          `
          SELECT id FROM vendors
          WHERE id = $1
            AND organization_id = $2
            AND status = 'active'
          `,
          [input.subject_id, organizationId]
        );

        if ((vendorCheck.rowCount ?? 0) === 0) {
          res.status(404).json({ error: "vendor_not_found" });
          return;
        }
      }

      // Upsert — detect insert vs update via xmax
      const upsertResult = await pg.query<{
        id: string;
        requirement_id: string;
        assessment_type: string;
        subject_id: string;
        status: string;
        notes: string | null;
        evidence_url: string | null;
        assessed_at: string;
        was_updated: boolean;
      }>(
        `
        INSERT INTO requirement_responses (
          organization_id,
          requirement_id,
          assessment_type,
          subject_id,
          status,
          notes,
          evidence_url,
          assessed_by,
          assessed_at
        )
        VALUES ($1, $2, $3, $4::uuid, $5, $6, $7, $8, NOW())
        ON CONFLICT (organization_id, requirement_id, assessment_type, subject_id)
        DO UPDATE SET
          status       = EXCLUDED.status,
          notes        = EXCLUDED.notes,
          evidence_url = EXCLUDED.evidence_url,
          assessed_by  = EXCLUDED.assessed_by,
          assessed_at  = NOW(),
          updated_at   = NOW()
        RETURNING
          id,
          requirement_id,
          assessment_type,
          subject_id,
          status,
          notes,
          evidence_url,
          assessed_at,
          (xmax::text::bigint > 0) AS was_updated
        `,
        [
          organizationId,
          input.requirement_id,
          input.assessment_type,
          input.subject_id,
          input.status,
          input.notes,
          input.evidence_url,
          (req as any).userId ?? null
        ]
      );

      const row = upsertResult.rows[0]!;
      const updated = Boolean(row.was_updated);

      logger.info(
        {
          event: "requirement_response_upserted",
          organizationId,
          requirementId: input.requirement_id,
          assessmentType: input.assessment_type,
          subjectId: input.subject_id,
          status: input.status,
          updated
        },
        "Requirement response upserted"
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId: (req as any).userId ?? null,
        eventType: updated
          ? "requirement_response.updated"
          : "requirement_response.created",
        resourceType: "requirement_response",
        resourceId: row.id,
        payload: {
          requirement_id: input.requirement_id,
          assessment_type: input.assessment_type,
          subject_id: input.subject_id,
          status: input.status
        },
        ipAddress: req.ip ?? null
      });

      res.status(200).json({
        response: {
          id: row.id,
          requirement_id: row.requirement_id,
          assessment_type: row.assessment_type,
          subject_id: row.subject_id,
          status: row.status,
          notes: row.notes,
          evidence_url: row.evidence_url,
          assessed_at: row.assessed_at
        },
        updated
      });
    } catch (err) {
      logger.error(
        { event: "requirement_response_upsert_failed", err },
        "POST /api/requirement-responses failed"
      );
      res.status(500).json({ error: "requirement_response_upsert_failed" });
    }
  }
);

/* =========================================================
   GET /api/requirement-responses
   Returns all responses for a given framework + subject.
   Only rows with existing responses are returned (no nulls).

   Query params:
     - framework_id:    uuid (required)
     - assessment_type: 'self' | 'vendor' (required)
     - subject_id:      uuid (required)
   ========================================================= */

router.get(
  "/requirement-responses",
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

    const frameworkId = isNonEmptyString(req.query.framework_id)
      ? (req.query.framework_id as string).trim()
      : null;
    if (!frameworkId) {
      res.status(400).json({ error: "framework_id_required" });
      return;
    }
    if (!isUuid(frameworkId)) {
      res.status(400).json({ error: "framework_id_must_be_uuid" });
      return;
    }

    const assessmentType = isNonEmptyString(req.query.assessment_type)
      ? (req.query.assessment_type as string).trim()
      : null;
    if (!assessmentType) {
      res.status(400).json({ error: "assessment_type_required" });
      return;
    }
    if (assessmentType !== "self" && assessmentType !== "vendor") {
      res.status(400).json({
        error: "invalid_assessment_type",
        detail: "Must be one of: self, vendor"
      });
      return;
    }

    const subjectId = isNonEmptyString(req.query.subject_id)
      ? (req.query.subject_id as string).trim()
      : null;
    if (!subjectId) {
      res.status(400).json({ error: "subject_id_required" });
      return;
    }
    if (!isUuid(subjectId)) {
      res.status(400).json({ error: "subject_id_must_be_uuid" });
      return;
    }

    try {
      // Verify framework belongs to org
      const frameworkResult = await pg.query(
        `SELECT id FROM frameworks WHERE id = $1 AND organization_id = $2`,
        [frameworkId, organizationId]
      );

      if ((frameworkResult.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "framework_not_found" });
        return;
      }

      const result = await pg.query<{
        id: string;
        requirement_id: string;
        reference_id: string;
        title: string;
        assessment_type: string;
        subject_id: string;
        status: string;
        notes: string | null;
        evidence_url: string | null;
        assessed_at: string;
      }>(
        `
        SELECT
          rr.id,
          rr.requirement_id,
          r.reference_id,
          r.title,
          rr.assessment_type,
          rr.subject_id,
          rr.status,
          rr.notes,
          rr.evidence_url,
          rr.assessed_at
        FROM requirement_responses rr
        JOIN requirements r ON r.id = rr.requirement_id
        WHERE rr.organization_id = $1
          AND rr.assessment_type  = $2
          AND rr.subject_id       = $3::uuid
          AND r.framework_id      = $4
        ORDER BY r.created_at ASC, r.id ASC
        `,
        [organizationId, assessmentType, subjectId, frameworkId]
      );

      res.status(200).json({
        count: result.rows.length,
        framework_id: frameworkId,
        assessment_type: assessmentType,
        subject_id: subjectId,
        responses: result.rows
      });
    } catch (err) {
      logger.error(
        { event: "requirement_responses_list_failed", err },
        "GET /api/requirement-responses failed"
      );
      res.status(500).json({ error: "requirement_responses_list_failed" });
    }
  }
);

export default router;
