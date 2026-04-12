/**
 * aiSystems.ts — AI system governance primitives API
 *
 * AI systems are a first-class platform primitive: they represent AI models,
 * use cases, or AI-enabled workflows under governance within an organization.
 * Every ai_systems record is org-scoped.
 *
 * Findings originating from governance reviews reference the review via
 * source_type = 'ai_review' and source_id = governance_reviews.id
 * (convention, not FK — source_id is polymorphic).
 *
 * Routes:
 *   POST  /api/ai-systems       — create AI system
 *   GET   /api/ai-systems       — list AI systems (cursor paginated)
 *   GET   /api/ai-systems/:id   — get single AI system
 *
 * No PATCH, no delete in this package.
 * All routes use the standard middleware chain.
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { validateAiSystemCreate } from "../lib/aiSystemValidation.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const VALID_CRITICALITY_FILTERS = new Set(["critical", "high", "medium", "low"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const AI_SYSTEM_SELECT = `
  id,
  organization_id,
  name,
  use_case,
  owner_user_id,
  model_type,
  data_classification,
  deployment_status,
  criticality,
  risk_classification,
  created_at,
  updated_at
`;

function parseLimit(value: unknown): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/* =========================================================
   POST /api/ai-systems
   Create an AI system for the requesting organization.
   ========================================================= */

router.post(
  "/ai-systems",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    try {
      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId ?? null;

      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const validated = validateAiSystemCreate(req.body);
      if ("error" in validated) {
        res.status(400).json(validated);
        return;
      }

      const { input } = validated;

      let result;
      try {
        result = await pg.query(
          `
          INSERT INTO ai_systems (
            organization_id,
            name,
            use_case,
            owner_user_id,
            model_type,
            data_classification,
            deployment_status,
            criticality,
            risk_classification
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING ${AI_SYSTEM_SELECT}
          `,
          [
            organizationId,
            input.name,
            input.use_case ?? null,
            input.owner_user_id ?? null,
            input.model_type ?? null,
            input.data_classification ?? null,
            input.deployment_status ?? null,
            input.criticality ?? null,
            input.risk_classification ?? null
          ]
        );
      } catch (err: any) {
        if (err?.code === "23505") {
          res.status(409).json({
            error: "ai_system_name_already_exists",
            name: input.name
          });
          return;
        }
        throw err;
      }

      logger.info(
        {
          event: "ai_system_created",
          organizationId,
          aiSystemId: result.rows[0]?.id,
          name: input.name
        },
        "AI system created"
      );

      res.status(201).json({ ai_system: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "ai_system_create_failed", err },
        "POST /api/ai-systems failed"
      );
      res.status(500).json({ error: "ai_system_create_failed" });
    }
  }
);

/* =========================================================
   GET /api/ai-systems
   List AI systems for the requesting organization.
   Supports cursor pagination and criticality filter.
   ========================================================= */

router.get(
  "/ai-systems",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    try {
      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId ?? null;

      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

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

      const filterCriticality = isNonEmptyString(req.query.criticality)
        ? req.query.criticality
        : null;
      if (filterCriticality !== null) {
        if (!VALID_CRITICALITY_FILTERS.has(filterCriticality)) {
          res.status(400).json({
            error: "invalid_criticality_filter",
            allowed: [...VALID_CRITICALITY_FILTERS]
          });
          return;
        }
        params.push(filterCriticality);
        conditions.push(`criticality = $${params.length}`);
      }

      if (useCursor) {
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
        SELECT ${AI_SYSTEM_SELECT}
        FROM ai_systems
        ${whereClause}
        ORDER BY
          CASE criticality
            WHEN 'critical' THEN 1
            WHEN 'high'     THEN 2
            WHEN 'medium'   THEN 3
            WHEN 'low'      THEN 4
            ELSE 5
          END,
          created_at DESC,
          id DESC
        LIMIT $${limitParam}
        `,
        params
      );

      const aiSystems = result.rows;
      const last = aiSystems.length > 0 ? aiSystems[aiSystems.length - 1] : null;

      res.status(200).json({
        count: aiSystems.length,
        limit,
        organizationId,
        nextCursor:
          last != null ? { created_at: last.created_at, id: last.id } : null,
        ai_systems: aiSystems
      });
    } catch (err) {
      logger.error(
        { event: "ai_systems_list_failed", err },
        "GET /api/ai-systems failed"
      );
      res.status(500).json({ error: "ai_systems_list_failed" });
    }
  }
);

/* =========================================================
   GET /api/ai-systems/:id
   Get a single AI system by ID. Returns 404 if the system
   does not exist or belongs to a different organization.
   ========================================================= */

router.get(
  "/ai-systems/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    try {
      const organizationContext = (req as any).organizationContext ?? null;
      const organizationId = organizationContext?.organizationId ?? null;

      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const aiSystemId = String(req.params.id ?? "").trim();
      if (!aiSystemId) {
        res.status(400).json({ error: "ai_system_id_required" });
        return;
      }
      if (!UUID_RE.test(aiSystemId)) {
        res.status(400).json({ error: "ai_system_id_must_be_uuid" });
        return;
      }

      const result = await pg.query(
        `
        SELECT ${AI_SYSTEM_SELECT}
        FROM ai_systems
        WHERE id = $1
          AND organization_id = $2
        `,
        [aiSystemId, organizationId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "ai_system_not_found" });
        return;
      }

      res.status(200).json({ ai_system: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "ai_system_get_failed", err },
        "GET /api/ai-systems/:id failed"
      );
      res.status(500).json({ error: "ai_system_get_failed" });
    }
  }
);

export default router;
