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
 *   POST   /api/ai-systems       — create AI system
 *   GET    /api/ai-systems       — list AI systems (cursor paginated)
 *   GET    /api/ai-systems/:id   — get single AI system
 *   PATCH  /api/ai-systems/:id   — update AI system metadata
 *   DELETE /api/ai-systems/:id   — delete AI system (pre-flight check)
 *
 * All routes use the standard middleware chain.
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { validateAiSystemCreate } from "../lib/aiSystemValidation.js";
import { writeAuditEvent } from "../lib/auditLog.js";

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
            input.owner_user_id ?? (req as any).autoUserId ?? null,
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

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId: req.userId ?? null,
        eventType: "ai_system.created",
        resourceType: "ai_system",
        resourceId: result.rows[0].id as string,
        payload: { name: input.name },
        ipAddress: req.ip ?? null
      });

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

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/* =========================================================
   PATCH /api/ai-systems/:id
   Update AI system metadata. Partial update — only provided
   fields are changed.
   ========================================================= */

router.patch(
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
      if (!isUuid(aiSystemId)) {
        res.status(400).json({ error: "ai_system_id_must_be_uuid" });
        return;
      }

      const body = req.body as Record<string, unknown>;

      const setClauses: string[] = [];
      const params: unknown[] = [aiSystemId, organizationId];

      function addField(col: string, value: unknown): void {
        params.push(value);
        setClauses.push(`${col} = $${params.length}`);
      }

      if ("name" in body) {
        const name = body["name"];
        if (typeof name !== "string" || name.trim().length === 0) {
          res.status(400).json({ error: "name_must_be_non_empty_string" });
          return;
        }
        addField("name", name.trim());
      }

      if ("use_case" in body) {
        const v = body["use_case"];
        if (v !== null && typeof v !== "string") {
          res.status(400).json({ error: "use_case_must_be_string_or_null" });
          return;
        }
        addField("use_case", v ?? null);
      }

      if ("owner_user_id" in body) {
        const v = body["owner_user_id"];
        if (v !== null && !isUuid(v)) {
          res.status(400).json({ error: "owner_user_id_must_be_uuid_or_null" });
          return;
        }
        addField("owner_user_id", v ?? null);
      }

      if ("model_type" in body) {
        const v = body["model_type"];
        if (v !== null && typeof v !== "string") {
          res.status(400).json({ error: "model_type_must_be_string_or_null" });
          return;
        }
        addField("model_type", v ?? null);
      }

      if ("data_classification" in body) {
        const v = body["data_classification"];
        if (v !== null && typeof v !== "string") {
          res.status(400).json({ error: "data_classification_must_be_string_or_null" });
          return;
        }
        addField("data_classification", v ?? null);
      }

      if ("deployment_status" in body) {
        const v = body["deployment_status"];
        if (v !== null && typeof v !== "string") {
          res.status(400).json({ error: "deployment_status_must_be_string_or_null" });
          return;
        }
        addField("deployment_status", v ?? null);
      }

      if ("criticality" in body) {
        const v = body["criticality"];
        if (v !== null && (typeof v !== "string" || !VALID_CRITICALITY_FILTERS.has(v))) {
          res.status(400).json({ error: "invalid_criticality", allowed: [...VALID_CRITICALITY_FILTERS] });
          return;
        }
        addField("criticality", v ?? null);
      }

      if ("risk_classification" in body) {
        const v = body["risk_classification"];
        if (v !== null && typeof v !== "string") {
          res.status(400).json({ error: "risk_classification_must_be_string_or_null" });
          return;
        }
        addField("risk_classification", v ?? null);
      }

      if (setClauses.length === 0) {
        res.status(400).json({ error: "no_valid_fields_provided" });
        return;
      }

      setClauses.push("updated_at = NOW()");

      const result = await pg.query(
        `UPDATE ai_systems
         SET ${setClauses.join(", ")}
         WHERE id = $1 AND organization_id = $2
         RETURNING ${AI_SYSTEM_SELECT}`,
        params
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "ai_system_not_found" });
        return;
      }

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId: req.userId ?? null,
        eventType: "ai_system.updated",
        resourceType: "ai_system",
        resourceId: aiSystemId,
        payload: { fields: setClauses.slice(0, -1).map((s) => s.split(" = ")[0] ?? s) },
        ipAddress: req.ip ?? null
      });

      res.status(200).json({ ai_system: result.rows[0] });
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "23505") {
        res.status(409).json({ error: "ai_system_name_already_exists" });
        return;
      }
      logger.error({ event: "ai_system_patch_failed", err }, "PATCH /api/ai-systems/:id failed");
      res.status(500).json({ error: "ai_system_patch_failed" });
    }
  }
);

/* =========================================================
   DELETE /api/ai-systems/:id
   Hard delete with pre-flight check for governance reviews.
   Requires JWT auth (requireAuth) for user attribution.
   ========================================================= */

router.delete(
  "/ai-systems/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  requireAuth,
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
      if (!isUuid(aiSystemId)) {
        res.status(400).json({ error: "ai_system_id_must_be_uuid" });
        return;
      }

      // Pre-flight: check for governance reviews (ON DELETE RESTRICT)
      const countResult = await pg.query<{ reviews: string }>(
        `SELECT COUNT(*)::int AS reviews
         FROM ai_governance_reviews
         WHERE ai_system_id = $1`,
        [aiSystemId]
      );
      const reviewCount = Number(countResult.rows[0]?.reviews ?? 0);

      if (reviewCount > 0) {
        res.status(409).json({
          error: "ai_system_has_reviews",
          message: "This AI system cannot be deleted because it has linked governance reviews.",
          details: { reviews: reviewCount }
        });
        return;
      }

      const result = await pg.query(
        `DELETE FROM ai_systems
         WHERE id = $1 AND organization_id = $2`,
        [aiSystemId, organizationId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "ai_system_not_found" });
        return;
      }

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId: req.userId ?? null,
        eventType: "ai_system.deleted",
        resourceType: "ai_system",
        resourceId: aiSystemId,
        payload: {},
        ipAddress: req.ip ?? null
      });

      res.status(200).json({ ok: true });
    } catch (err) {
      logger.error({ event: "ai_system_delete_failed", err }, "DELETE /api/ai-systems/:id failed");
      res.status(500).json({ error: "ai_system_delete_failed" });
    }
  }
);

export default router;
