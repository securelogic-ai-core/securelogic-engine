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
 *   GET    /api/ai-systems/:id/findings — findings linked to one system, with TRUE counts
 *   PATCH  /api/ai-systems/:id   — update AI system metadata
 *   DELETE /api/ai-systems/:id   — delete AI system (pre-flight check)
 *
 * All routes use the standard middleware chain.
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { assetRegistryEnabled } from "../lib/assetRegistryFeatureFlag.js";
import { registerAsset, deregisterAsset } from "../lib/assetRegistrar.js";
import {
  backingIdsOf,
  normalizeAssetSearchTerm,
  resolveAssetSearch
} from "../lib/assetSearchResolver.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { asTenant } from "../middleware/asTenant.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { requirePremiumOrCorePlatform } from "../lib/corePlatformCapability.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdminRole } from "../middleware/requireRole.js";
import { validateAiSystemCreate } from "../lib/aiSystemValidation.js";
import { sqlFindingActive } from "../lib/metricDefinitions.js";
import { enforceEntityLimit } from "../lib/entityLimit.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  AI_SYSTEM_HISTORY_SPEC,
  fetchResourceHistory,
  isHistoryUuid,
  parseHistoryLimit,
  parseHistoryOffset,
} from "../lib/resourceHistory.js";

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
  requirePremiumOrCorePlatform,
  asTenant(async (req, res) => {
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

      // Monitored-entity cap (vendors + ai_systems combined). Checked at
      // creation time; existing over-cap rows are grandfathered.
      const limit = await enforceEntityLimit(organizationId);
      if (limit.exceeded) {
        res.status(409).json({
          error: "entity_limit_reached",
          detail: `Your plan allows up to ${limit.cap} monitored entities (vendors + AI systems). Delete one or upgrade to add more.`
        });
        return;
      }

      const { input } = validated;

      let result;
      try {
        // Single tx via the route's asTenant wrap (P8) — the EAR registry
        // upsert (flag-gated, dark by default) stays atomic with the INSERT.
        {
          const created = await pg.query(
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
          if (assetRegistryEnabled()) {
            await registerAsset(organizationId, "ai_system", "ai_systems", (created.rows[0] as { id: string }).id);
          }
          result = created;
        }
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
  })
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
  requirePremiumOrCorePlatform,
  asTenant(async (req, res) => {
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

      // Shared asset-search q — the platform capability (name, alias, exact
      // UUID, any registry identifier), narrowed to AI-system-typed assets
      // and applied by BACKING id, so this list never re-implements matching.
      const rawQ = req.query.q;
      if (rawQ !== undefined && !(typeof rawQ === "string" && rawQ.trim().length === 0)) {
        const searchTerm = normalizeAssetSearchTerm(rawQ);
        if (searchTerm === null) {
          res.status(400).json({ error: "invalid_search" });
          return;
        }
        const resolved = await resolveAssetSearch(pg, organizationId, searchTerm, {
          assetTypes: ["ai_system"]
        });
        const aiSystemIds = backingIdsOf(resolved.matches, "ai_systems");
        if (aiSystemIds.length === 0) {
          res.status(200).json({
            count: 0,
            limit,
            organizationId,
            nextCursor: null,
            ai_systems: []
          });
          return;
        }
        params.push(aiSystemIds);
        conditions.push(`id = ANY($${params.length}::uuid[])`);
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
  })
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
  requirePremiumOrCorePlatform,
  asTenant(async (req, res) => {
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
  })
);

/* =========================================================
   GET /api/ai-systems/:id/history
   Per-AI-system audit trail — the RR-3 per-risk history pattern
   generalized via src/api/lib/resourceHistory.ts. Events on the
   system plus its governance reviews and governance assessments,
   newest first, mirroring the GET /api/audit-log field shape.

   Auth mirrors GET /api/ai-systems/:id (no admin gate) — anyone
   who can read the system can read its history.
   ========================================================= */

router.get(
  "/ai-systems/:id/history",
  requireApiKey,
  attachOrganizationContext,
  requirePremiumOrCorePlatform,
  asTenant(async (req, res) => {
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
    if (!isHistoryUuid(aiSystemId)) {
      res.status(400).json({ error: "ai_system_id_must_be_uuid" });
      return;
    }

    const limit  = parseHistoryLimit(req.query.limit);
    const offset = parseHistoryOffset(req.query.offset);

    try {
      // Ownership first: cross-org probes must 404 (an empty events
      // list for a foreign id would leak existence by absence).
      const ownership = await pg.query(
        `SELECT 1 FROM ai_systems WHERE id = $1 AND organization_id = $2`,
        [aiSystemId, organizationId]
      );
      if ((ownership.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "ai_system_not_found" });
        return;
      }

      const page = await fetchResourceHistory(
        AI_SYSTEM_HISTORY_SPEC,
        organizationId,
        aiSystemId,
        limit,
        offset
      );
      res.status(200).json(page);
    } catch (err) {
      logger.error(
        { event: "ai_system_history_failed", err, aiSystemId },
        "GET /api/ai-systems/:id/history failed"
      );
      res.status(500).json({ error: "ai_system_history_failed" });
    }
  })
);

/* =========================================================
   GET /api/ai-systems/:id/findings

   The findings linked to ONE AI system, resolved in the database.

   This exists because the detail page had no scoped route and improvised one:
   it fetched the org's findings with `limit: 50` and filtered them down to this
   system in the browser. Past 50 findings in the org, a system's real findings
   fell off the end of the page before the filter ever saw them — and the tile
   rendered "0 open findings" for a system that had them. A truncation is not a
   zero (the #637 rule), and a client-side filter over a truncated page is a
   truncation wearing a filter's clothes.

   Both linkage conventions are unioned, per their migrations:
     source_type 'ai_review'             → source_id = governance_reviews.id
     source_type 'ai_governance_review'  → source_id = ai_governance_assessments.id
   Neither ever holds an ai_system_id — the system is reached through the join.

   `total` and `active_total` are COUNT(*) over the WHOLE matched set, never the
   length of the returned page: the rows are for display and are bounded; the
   counts are the truth a tile is allowed to print.
   ========================================================= */

router.get(
  "/ai-systems/:id/findings",
  requireApiKey,
  attachOrganizationContext,
  requirePremiumOrCorePlatform,
  asTenant(async (req, res) => {
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

      const limit = Math.min(parseLimit(req.query.limit), MAX_LIMIT);

      // The matched set, defined once and reused by both the page and the counts,
      // so the number on the tile and the rows beneath it can never disagree.
      const linkedFindings = `
        SELECT f.id, f.title, f.severity, f.status, f.operational_status,
               f.domain, f.description,
               f.source_type, f.source_id, f.created_at, f.updated_at
        FROM findings f
        JOIN governance_reviews gr
          ON gr.id::text = f.source_id::text
         AND f.source_type = 'ai_review'
        WHERE gr.ai_system_id = $1
          AND gr.organization_id = $2
          AND f.organization_id = $2

        UNION ALL

        SELECT f.id, f.title, f.severity, f.status, f.operational_status,
               f.domain, f.description,
               f.source_type, f.source_id, f.created_at, f.updated_at
        FROM findings f
        JOIN ai_governance_assessments aga
          ON aga.id::text = f.source_id::text
         AND f.source_type = 'ai_governance_review'
        WHERE aga.ai_system_id = $1
          AND aga.organization_id = $2
          AND f.organization_id = $2
      `;

      const [rowsResult, countResult] = await Promise.all([
        pg.query(
          `
          WITH linked AS (${linkedFindings})
          SELECT * FROM linked
          ORDER BY created_at DESC
          LIMIT $3
          `,
          [aiSystemId, organizationId, limit]
        ),
        pg.query<{ total: string; active_total: string; open_total: string }>(
          `
          WITH linked AS (${linkedFindings})
          SELECT
            COUNT(*)::text                                        AS total,
            COUNT(*) FILTER (WHERE ${sqlFindingActive()})::text   AS active_total,
            COUNT(*) FILTER (WHERE status = 'open')::text         AS open_total
          FROM linked
          `,
          [aiSystemId, organizationId]
        )
      ]);

      const counts = countResult.rows[0];
      res.status(200).json({
        findings: rowsResult.rows,
        total: parseInt(counts?.total ?? "0", 10),
        // BOTH populations are carried, and both are true counts.
        //
        // active_total is the Metric Contract population (operational_status <>
        // 'closed') — the definition every enterprise surface counts, and what this
        // page now displays. open_total is the strictly-open LIFECYCLE population,
        // retained as an explicit filter, never as the enterprise metric.
        //
        // They are both here on purpose. The word "open findings" currently denotes
        // THREE different populations across the product (dashboard: active; vendor
        // detail: active; AI-system and obligation detail: strictly open), and
        // resolving that is a platform vocabulary decision, not a detail-page one.
        // This route refuses to prejudge it: it reports both honestly and lets the
        // surface choose, so whichever way the decision lands, the number is already
        // on the wire and no caller has to re-derive it from a truncated page.
        active_total: parseInt(counts?.active_total ?? "0", 10),
        open_total: parseInt(counts?.open_total ?? "0", 10),
      });
    } catch (err) {
      logger.error(
        { event: "ai_system_findings_failed", err },
        "GET /api/ai-systems/:id/findings failed"
      );
      res.status(500).json({ error: "ai_system_findings_failed" });
    }
  })
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
  requirePremiumOrCorePlatform,
  asTenant(async (req, res) => {
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
  })
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
  requirePremiumOrCorePlatform,
  requireAdminRole,
  requireAuth,
  asTenant(async (req, res) => {
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

      // Single tx via the route's asTenant wrap (P8) — registry
      // deregistration (flag-gated) stays atomic with the DELETE.
      const result = await pg.query(
        `DELETE FROM ai_systems
         WHERE id = $1 AND organization_id = $2`,
        [aiSystemId, organizationId]
      );
      if ((result.rowCount ?? 0) > 0 && assetRegistryEnabled()) {
        await deregisterAsset(organizationId, "ai_systems", aiSystemId);
      }

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
  })
);

export default router;
