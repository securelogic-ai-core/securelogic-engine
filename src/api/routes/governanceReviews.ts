/**
 * governanceReviews.ts — AI governance review workflow API
 *
 * A governance review is a structured, org-scoped record representing a
 * point-in-time review of an AI system's governance posture. Creating a review
 * produces exactly one finding with:
 *   source_type = 'ai_review'
 *   source_id   = governance_reviews.id  (NOT ai_system_id)
 *   domain      = 'AI Governance'
 *
 * This linkage convention allows GET /api/governance-reviews/:id to return
 * the exact finding produced by the review via source_id equality.
 *
 * Routes:
 *   POST  /api/governance-reviews       — create review + finding (transactional)
 *   GET   /api/governance-reviews       — list reviews for org (cursor paginated)
 *   GET   /api/governance-reviews/:id   — get single review with its finding
 *
 * Constraints:
 *   - The ai_system must exist and belong to the same organization.
 *   - No PATCH, no delete in this package. Reviews are immutable once created.
 *   - All routes use the standard middleware chain.
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { validateGovernanceReviewCreate } from "../lib/governanceReviewValidation.js";
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

const REVIEW_SELECT = `
  id,
  organization_id,
  ai_system_id,
  review_type,
  performed_at,
  reviewer_id,
  outcome,
  summary,
  created_at,
  updated_at
`;

/* =========================================================
   POST /api/governance-reviews
   Create a governance review for an AI system that belongs
   to the requesting organization.
   Atomically inserts: governance_reviews row + findings row.
   ========================================================= */

router.post(
  "/governance-reviews",
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

    const validated = validateGovernanceReviewCreate(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    const client = await pg.connect();
    try {
      await client.query("BEGIN");

      // Verify that the AI system exists and belongs to this org.
      // FOR UPDATE prevents a concurrent modification from racing between
      // this check and the review insert.
      const systemResult = await client.query(
        `
        SELECT id, name
        FROM ai_systems
        WHERE id = $1
          AND organization_id = $2
        FOR UPDATE
        `,
        [input.ai_system_id, organizationId]
      );

      if ((systemResult.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "ai_system_not_found" });
        return;
      }

      const systemName = systemResult.rows[0].name as string;
      const performedAt =
        input.performed_at ?? new Date().toISOString().slice(0, 10);

      // Insert the governance review record.
      const reviewResult = await client.query(
        `
        INSERT INTO governance_reviews (
          organization_id,
          ai_system_id,
          review_type,
          performed_at,
          reviewer_id,
          outcome,
          summary
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING ${REVIEW_SELECT}
        `,
        [
          organizationId,
          input.ai_system_id,
          input.review_type,
          performedAt,
          input.reviewer_id ?? null,
          input.outcome ?? null,
          input.summary ?? null
        ]
      );

      const review = reviewResult.rows[0];
      const reviewId: string = review.id;

      // Idempotency guard: check whether a finding for this review already
      // exists before creating one. This prevents duplicates if the request
      // is retried after a partial failure where the review row committed but
      // the finding insert did not.
      const existingFindingResult = await client.query<{ id: string }>(
        `SELECT id FROM findings
         WHERE organization_id = $1
           AND source_type = 'ai_review'
           AND source_id = $2::uuid
         LIMIT 1`,
        [organizationId, reviewId]
      );

      let finding: Record<string, unknown>;

      if ((existingFindingResult.rowCount ?? 0) > 0) {
        // Finding already exists for this review — return it without re-inserting.
        finding = existingFindingResult.rows[0]!;
      } else {
        // Insert the finding linked to this review.
        // source_type = 'ai_review', source_id = reviewId (NOT ai_system_id).
        // domain = 'AI Governance' — hardcoded so findings feed the correct domain
        // bucket in DomainRiskAggregationEngineV2 on next posture snapshot.
        const priority = severityToPriority(input.overall_severity);
        const findingTitle = `AI Governance: ${systemName} — ${input.overall_severity} severity`;
        const findingDescription =
          input.summary != null && input.summary.trim().length > 0
            ? input.summary.trim()
            : `AI governance finding from ${input.review_type} review.`;

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
          VALUES ($1, NULL, 'ai_review', $2::uuid, $3, $4, $5, 'AI Governance', $6, 'open')
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
            reviewId,
            findingTitle,
            findingDescription,
            input.overall_severity,
            priority
          ]
        );

        finding = findingResult.rows[0];
      }

      await client.query("COMMIT");

      logger.info(
        {
          event: "governance_review_created",
          organizationId,
          reviewId,
          aiSystemId: input.ai_system_id,
          findingId: finding.id,
          overall_severity: input.overall_severity
        },
        "Governance review created"
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId: req.userId ?? null,
        eventType: "governance_review.created",
        resourceType: "governance_review",
        resourceId: reviewId,
        payload: { aiSystemId: input.ai_system_id, severity: input.overall_severity, findingId: finding.id },
        ipAddress: req.ip ?? null
      });

      res.status(201).json({ review, finding });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }

      logger.error(
        { event: "governance_review_create_failed", err },
        "POST /api/governance-reviews failed"
      );
      res.status(500).json({ error: "governance_review_create_failed" });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   GET /api/governance-reviews
   List governance reviews for the requesting organization.
   Supports cursor pagination and ai_system_id filter.
   ========================================================= */

router.get(
  "/governance-reviews",
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

      const filterAiSystemId = isNonEmptyString(req.query.ai_system_id)
        ? req.query.ai_system_id.trim()
        : null;
      if (filterAiSystemId !== null) {
        if (!isUuid(filterAiSystemId)) {
          res.status(400).json({ error: "ai_system_id_must_be_uuid" });
          return;
        }
        params.push(filterAiSystemId);
        conditions.push(`ai_system_id = $${params.length}::uuid`);
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
        FROM governance_reviews
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
        { event: "governance_reviews_list_failed", err },
        "GET /api/governance-reviews failed"
      );
      res.status(500).json({ error: "governance_reviews_list_failed" });
    }
  }
);

/* =========================================================
   GET /api/governance-reviews/:id
   Get a single governance review with its associated finding.
   Returns 404 if the review does not belong to this org.

   The finding is retrieved by:
     source_type = 'ai_review' AND source_id = review.id
   This is the exact finding created by POST /api/governance-reviews.
   ========================================================= */

router.get(
  "/governance-reviews/:id",
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
        FROM governance_reviews
        WHERE id = $1
          AND organization_id = $2
        `,
        [reviewId, organizationId]
      );

      if ((reviewResult.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "governance_review_not_found" });
        return;
      }

      const review = reviewResult.rows[0];

      // Retrieve the finding created for this specific review.
      // source_id = review.id (not ai_system_id) — exact linkage.
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
          AND source_type = 'ai_review'
          AND source_id = $2::uuid
        ORDER BY created_at DESC, id DESC
        `,
        [organizationId, reviewId]
      );

      const finding = findingResult.rows[0] ?? null;

      res.status(200).json({ review, finding });
    } catch (err) {
      logger.error(
        { event: "governance_review_get_failed", err },
        "GET /api/governance-reviews/:id failed"
      );
      res.status(500).json({ error: "governance_review_get_failed" });
    }
  }
);

export default router;
