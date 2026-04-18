/**
 * policies.ts — Policy Register API
 *
 * Policies are organizational security/compliance policy documents with
 * version tracking and review cycle management.
 *
 * Routes:
 *   POST   /api/policies                        — create policy
 *   GET    /api/policies                        — list policies
 *   GET    /api/policies/:id                    — get policy with linked controls
 *   PATCH  /api/policies/:id                    — update policy fields
 *   POST   /api/policies/:id/controls           — link a control to a policy
 *   DELETE /api/policies/:id/controls/:controlId — unlink a control
 *
 * All routes use the standard middleware chain.
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { writeAuditEvent } from "../lib/auditLog.js";

const router = Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const VALID_CATEGORIES = new Set([
  "access_control",
  "incident_response",
  "change_management",
  "data_classification",
  "business_continuity",
  "acceptable_use",
  "vendor_management",
  "vulnerability_management",
  "other",
]);

const VALID_STATUSES = new Set(["draft", "active", "under_review", "retired"]);

const VALID_REVIEW_FREQUENCIES = new Set(["annual", "biannual", "ad_hoc"]);

const REVIEW_DAYS: Record<string, number> = {
  annual: 365,
  biannual: 180,
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && ISO_DATE_RE.test(v);
}

function parseLimit(value: unknown): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const POLICY_SELECT = `
  id,
  organization_id,
  name,
  description,
  category,
  version,
  owner,
  status,
  review_frequency,
  last_reviewed_at,
  next_review_at,
  (
    next_review_at IS NOT NULL
    AND next_review_at < CURRENT_DATE
    AND review_frequency IS NOT NULL
    AND review_frequency != 'ad_hoc'
  ) AS is_overdue,
  created_at,
  updated_at
`;

/* =========================================================
   POST /api/policies
   ========================================================= */

router.post(
  "/policies",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    const organizationId =
      (req as any).organizationContext?.organizationId ?? null;
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const body = req.body as Record<string, unknown>;

    const name = typeof body["name"] === "string" ? body["name"].trim() : "";
    if (!name) {
      res.status(400).json({ error: "name_required" });
      return;
    }

    const description =
      typeof body["description"] === "string" ? body["description"] : null;

    const category =
      typeof body["category"] === "string" ? body["category"].trim() : "other";
    if (!VALID_CATEGORIES.has(category)) {
      res.status(400).json({ error: "invalid_category", allowed: [...VALID_CATEGORIES] });
      return;
    }

    const version =
      typeof body["version"] === "string" ? body["version"].trim() || null : null;

    const owner =
      typeof body["owner"] === "string" ? body["owner"].trim() || null : null;

    const status =
      typeof body["status"] === "string" ? body["status"].trim() : "draft";
    if (!VALID_STATUSES.has(status)) {
      res.status(400).json({ error: "invalid_status", allowed: [...VALID_STATUSES] });
      return;
    }

    const reviewFrequency =
      typeof body["review_frequency"] === "string"
        ? body["review_frequency"].trim() || null
        : null;
    if (reviewFrequency !== null && !VALID_REVIEW_FREQUENCIES.has(reviewFrequency)) {
      res.status(400).json({ error: "invalid_review_frequency", allowed: [...VALID_REVIEW_FREQUENCIES] });
      return;
    }

    const lastReviewedAt =
      typeof body["last_reviewed_at"] === "string" && isIsoDate(body["last_reviewed_at"])
        ? body["last_reviewed_at"]
        : null;

    const nextReviewAt =
      typeof body["next_review_at"] === "string" && isIsoDate(body["next_review_at"])
        ? body["next_review_at"]
        : null;

    try {
      const result = await pg.query(
        `
        INSERT INTO policies (
          organization_id, name, description, category, version, owner,
          status, review_frequency, last_reviewed_at, next_review_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING ${POLICY_SELECT}
        `,
        [
          organizationId,
          name,
          description,
          category,
          version,
          owner,
          status,
          reviewFrequency,
          lastReviewedAt,
          nextReviewAt,
        ]
      );

      logger.info(
        { event: "policy_created", organizationId, policyId: result.rows[0]?.id, name },
        "Policy created"
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId: req.userId ?? null,
        eventType: "policy.created",
        resourceType: "policy",
        resourceId: result.rows[0].id as string,
        payload: { name, category, status },
        ipAddress: req.ip ?? null
      });

      res.status(201).json({ policy: result.rows[0] });
    } catch (err) {
      logger.error({ event: "policy_create_failed", err }, "POST /api/policies failed");
      res.status(500).json({ error: "policy_create_failed" });
    }
  }
);

/* =========================================================
   GET /api/policies
   ========================================================= */

router.get(
  "/policies",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    const organizationId =
      (req as any).organizationContext?.organizationId ?? null;
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const filterStatus = isNonEmptyString(req.query.status)
      ? (req.query.status as string).trim()
      : null;
    if (filterStatus !== null && !VALID_STATUSES.has(filterStatus)) {
      res.status(400).json({ error: "invalid_status_filter", allowed: [...VALID_STATUSES] });
      return;
    }

    const filterCategory = isNonEmptyString(req.query.category)
      ? (req.query.category as string).trim()
      : null;
    if (filterCategory !== null && !VALID_CATEGORIES.has(filterCategory)) {
      res.status(400).json({ error: "invalid_category_filter", allowed: [...VALID_CATEGORIES] });
      return;
    }

    const linkedToControl = isNonEmptyString(req.query.linked_to_control)
      ? (req.query.linked_to_control as string).trim()
      : null;
    if (linkedToControl !== null && !isUuid(linkedToControl)) {
      res.status(400).json({ error: "linked_to_control_must_be_uuid" });
      return;
    }

    const cursor = isNonEmptyString(req.query.cursor)
      ? (req.query.cursor as string).trim()
      : null;
    if (cursor !== null && !isUuid(cursor)) {
      res.status(400).json({ error: "cursor_must_be_uuid" });
      return;
    }

    const limit = parseLimit(req.query.limit);

    try {
      // Resolve cursor to (created_at, id) for keyset pagination
      let cursorCreatedAt: string | null = null;
      if (cursor !== null) {
        const cursorRow = await pg.query<{ created_at: string }>(
          `SELECT created_at FROM policies WHERE id = $1 AND organization_id = $2`,
          [cursor, organizationId]
        );
        cursorCreatedAt = cursorRow.rows[0]?.created_at ?? null;
      }

      const conditions: string[] = ["p.organization_id = $1"];
      const params: unknown[] = [organizationId];

      if (filterStatus !== null) {
        params.push(filterStatus);
        conditions.push(`p.status = $${params.length}`);
      }

      if (filterCategory !== null) {
        params.push(filterCategory);
        conditions.push(`p.category = $${params.length}`);
      }

      if (linkedToControl !== null) {
        params.push(linkedToControl);
        conditions.push(
          `EXISTS (SELECT 1 FROM policy_control_links pcl WHERE pcl.policy_id = p.id AND pcl.control_id = $${params.length})`
        );
      }

      if (cursor !== null && cursorCreatedAt !== null) {
        params.push(cursorCreatedAt, cursor);
        const ci = params.length - 1;
        conditions.push(`(p.created_at, p.id) < ($${ci}::timestamptz, $${ci + 1}::uuid)`);
      }

      const whereClause = conditions.join(" AND ");

      // Total count (without cursor filter)
      const countConditions: string[] = ["organization_id = $1"];
      const countParams: unknown[] = [organizationId];
      if (filterStatus !== null) {
        countParams.push(filterStatus);
        countConditions.push(`status = $${countParams.length}`);
      }
      if (filterCategory !== null) {
        countParams.push(filterCategory);
        countConditions.push(`category = $${countParams.length}`);
      }
      if (linkedToControl !== null) {
        countParams.push(linkedToControl);
        countConditions.push(
          `EXISTS (SELECT 1 FROM policy_control_links pcl WHERE pcl.policy_id = id AND pcl.control_id = $${countParams.length})`
        );
      }

      const [listResult, countResult] = await Promise.all([
        pg.query(
          `
          SELECT ${POLICY_SELECT.replace(/\n/g, "\n  ").replace(/^(\s+)/, "")}
          FROM policies p
          WHERE ${whereClause}
          ORDER BY p.created_at DESC, p.id DESC
          LIMIT $${(params.push(limit), params.length)}
          `,
          params
        ),
        pg.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM policies WHERE ${countConditions.join(" AND ")}`,
          countParams
        ),
      ]);

      const policies = listResult.rows;
      const total = parseInt(countResult.rows[0]?.count ?? "0", 10);
      const last = policies.length > 0 ? policies[policies.length - 1] : null;
      const nextCursor = last != null && policies.length === limit ? (last.id as string) : null;

      res.status(200).json({ policies, total, nextCursor });
    } catch (err) {
      logger.error({ event: "policies_list_failed", err }, "GET /api/policies failed");
      res.status(500).json({ error: "policies_list_failed" });
    }
  }
);

/* =========================================================
   GET /api/policies/:id
   ========================================================= */

router.get(
  "/policies/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    const organizationId =
      (req as any).organizationContext?.organizationId ?? null;
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const policyId = String(req.params["id"] ?? "").trim();
    if (!policyId) {
      res.status(400).json({ error: "policy_id_required" });
      return;
    }
    if (!isUuid(policyId)) {
      res.status(400).json({ error: "policy_id_must_be_uuid" });
      return;
    }

    try {
      const [policyResult, linksResult] = await Promise.all([
        pg.query(
          `SELECT ${POLICY_SELECT} FROM policies p WHERE p.id = $1 AND p.organization_id = $2`,
          [policyId, organizationId]
        ),
        pg.query<{ control_id: string; control_name: string }>(
          `
          SELECT pcl.control_id, c.name AS control_name
          FROM policy_control_links pcl
          JOIN controls c ON c.id = pcl.control_id
          WHERE pcl.policy_id = $1
          ORDER BY c.name ASC
          `,
          [policyId]
        ),
      ]);

      if ((policyResult.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "policy_not_found" });
        return;
      }

      const policy = {
        ...policyResult.rows[0],
        linked_controls: linksResult.rows,
      };

      res.status(200).json({ policy });
    } catch (err) {
      logger.error({ event: "policy_get_failed", err }, "GET /api/policies/:id failed");
      res.status(500).json({ error: "policy_get_failed" });
    }
  }
);

/* =========================================================
   PATCH /api/policies/:id
   ========================================================= */

router.patch(
  "/policies/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    const organizationId =
      (req as any).organizationContext?.organizationId ?? null;
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const policyId = String(req.params["id"] ?? "").trim();
    if (!policyId) {
      res.status(400).json({ error: "policy_id_required" });
      return;
    }
    if (!isUuid(policyId)) {
      res.status(400).json({ error: "policy_id_must_be_uuid" });
      return;
    }

    const body = req.body as Record<string, unknown>;

    const setClauses: string[] = [];
    const params: unknown[] = [policyId, organizationId];

    function addField(col: string, value: unknown): void {
      params.push(value);
      setClauses.push(`${col} = $${params.length}`);
    }

    if ("name" in body) {
      if (typeof body["name"] !== "string" || body["name"].trim().length === 0) {
        res.status(400).json({ error: "name_must_be_non_empty_string" });
        return;
      }
      addField("name", body["name"].trim());
    }

    if ("description" in body) {
      if (body["description"] !== null && typeof body["description"] !== "string") {
        res.status(400).json({ error: "description_must_be_string_or_null" });
        return;
      }
      addField("description", body["description"] ?? null);
    }

    if ("category" in body) {
      if (typeof body["category"] !== "string" || !VALID_CATEGORIES.has(body["category"])) {
        res.status(400).json({ error: "invalid_category", allowed: [...VALID_CATEGORIES] });
        return;
      }
      addField("category", body["category"]);
    }

    if ("version" in body) {
      if (body["version"] !== null && typeof body["version"] !== "string") {
        res.status(400).json({ error: "version_must_be_string_or_null" });
        return;
      }
      addField("version", (body["version"] as string | null)?.trim() || null);
    }

    if ("owner" in body) {
      if (body["owner"] !== null && typeof body["owner"] !== "string") {
        res.status(400).json({ error: "owner_must_be_string_or_null" });
        return;
      }
      addField("owner", (body["owner"] as string | null)?.trim() || null);
    }

    if ("status" in body) {
      if (typeof body["status"] !== "string" || !VALID_STATUSES.has(body["status"])) {
        res.status(400).json({ error: "invalid_status", allowed: [...VALID_STATUSES] });
        return;
      }
      addField("status", body["status"]);
    }

    if ("review_frequency" in body) {
      const freq = body["review_frequency"];
      if (freq !== null && (typeof freq !== "string" || !VALID_REVIEW_FREQUENCIES.has(freq))) {
        res.status(400).json({ error: "invalid_review_frequency", allowed: [...VALID_REVIEW_FREQUENCIES] });
        return;
      }
      addField("review_frequency", (freq as string | null) ?? null);
    }

    if ("last_reviewed_at" in body) {
      const lra = body["last_reviewed_at"];
      if (lra !== null && !isIsoDate(lra)) {
        res.status(400).json({ error: "last_reviewed_at_must_be_iso_date_or_null" });
        return;
      }
      addField("last_reviewed_at", lra ?? null);
    }

    if ("next_review_at" in body) {
      const nra = body["next_review_at"];
      if (nra !== null && !isIsoDate(nra)) {
        res.status(400).json({ error: "next_review_at_must_be_iso_date_or_null" });
        return;
      }
      addField("next_review_at", nra ?? null);
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: "no_valid_fields_provided" });
      return;
    }

    // Auto-compute review dates when transitioning to 'active'
    const isActivating = "status" in body && body["status"] === "active";
    if (isActivating) {
      let effectiveFreq: string | null = null;

      if ("review_frequency" in body && typeof body["review_frequency"] === "string") {
        effectiveFreq = body["review_frequency"];
      } else {
        const current = await pg.query<{ review_frequency: string | null }>(
          `SELECT review_frequency FROM policies WHERE id = $1 AND organization_id = $2`,
          [policyId, organizationId]
        );
        effectiveFreq = current.rows[0]?.review_frequency ?? null;
      }

      if (effectiveFreq && REVIEW_DAYS[effectiveFreq] !== undefined) {
        const days = REVIEW_DAYS[effectiveFreq]!;

        if (!("last_reviewed_at" in body)) {
          addField("last_reviewed_at", todayIso());
        }

        if (!("next_review_at" in body)) {
          const baseDateStr =
            "last_reviewed_at" in body && isIsoDate(body["last_reviewed_at"])
              ? (body["last_reviewed_at"] as string)
              : todayIso();
          addField("next_review_at", addDays(baseDateStr, days));
        }
      }
    }

    setClauses.push("updated_at = NOW()");

    try {
      const result = await pg.query(
        `
        UPDATE policies
        SET ${setClauses.join(", ")}
        WHERE id = $1
          AND organization_id = $2
        RETURNING ${POLICY_SELECT}
        `,
        params
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "policy_not_found" });
        return;
      }

      logger.info(
        {
          event: "policy_updated",
          organizationId,
          policyId,
          fields: setClauses.slice(0, -1).map((s) => s.split(" = ")[0]),
        },
        "Policy updated"
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId: req.userId ?? null,
        eventType: "policy.updated",
        resourceType: "policy",
        resourceId: policyId,
        payload: { fields: setClauses.slice(0, -1).map((s) => s.split(" = ")[0] ?? s) },
        ipAddress: req.ip ?? null
      });

      res.status(200).json({ policy: result.rows[0] });
    } catch (err) {
      logger.error({ event: "policy_patch_failed", err }, "PATCH /api/policies/:id failed");
      res.status(500).json({ error: "policy_patch_failed" });
    }
  }
);

/* =========================================================
   POST /api/policies/:id/controls
   Link a control to a policy.
   ========================================================= */

router.post(
  "/policies/:id/controls",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    const organizationId =
      (req as any).organizationContext?.organizationId ?? null;
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const policyId = String(req.params["id"] ?? "").trim();
    if (!policyId || !isUuid(policyId)) {
      res.status(400).json({ error: "policy_id_must_be_uuid" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const controlId = typeof body["control_id"] === "string" ? body["control_id"].trim() : "";
    if (!controlId || !isUuid(controlId)) {
      res.status(400).json({ error: "control_id_must_be_uuid" });
      return;
    }

    try {
      // Verify policy belongs to org
      const policyCheck = await pg.query(
        `SELECT id FROM policies WHERE id = $1 AND organization_id = $2`,
        [policyId, organizationId]
      );
      if ((policyCheck.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "policy_not_found" });
        return;
      }

      // Verify control belongs to same org
      const controlCheck = await pg.query(
        `SELECT id FROM controls WHERE id = $1 AND organization_id = $2`,
        [controlId, organizationId]
      );
      if ((controlCheck.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "control_not_found" });
        return;
      }

      await pg.query(
        `
        INSERT INTO policy_control_links (policy_id, control_id)
        VALUES ($1, $2)
        ON CONFLICT (policy_id, control_id) DO NOTHING
        `,
        [policyId, controlId]
      );

      res.status(201).json({ ok: true });
    } catch (err) {
      logger.error(
        { event: "policy_link_control_failed", err },
        "POST /api/policies/:id/controls failed"
      );
      res.status(500).json({ error: "policy_link_control_failed" });
    }
  }
);

/* =========================================================
   DELETE /api/policies/:id/controls/:controlId
   Unlink a control from a policy.
   ========================================================= */

router.delete(
  "/policies/:id/controls/:controlId",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    const organizationId =
      (req as any).organizationContext?.organizationId ?? null;
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const policyId = String(req.params["id"] ?? "").trim();
    if (!policyId || !isUuid(policyId)) {
      res.status(400).json({ error: "policy_id_must_be_uuid" });
      return;
    }

    const controlId = String(req.params["controlId"] ?? "").trim();
    if (!controlId || !isUuid(controlId)) {
      res.status(400).json({ error: "control_id_must_be_uuid" });
      return;
    }

    try {
      // Verify policy belongs to org
      const policyCheck = await pg.query(
        `SELECT id FROM policies WHERE id = $1 AND organization_id = $2`,
        [policyId, organizationId]
      );
      if ((policyCheck.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "policy_not_found" });
        return;
      }

      await pg.query(
        `DELETE FROM policy_control_links WHERE policy_id = $1 AND control_id = $2`,
        [policyId, controlId]
      );

      res.status(200).json({ ok: true });
    } catch (err) {
      logger.error(
        { event: "policy_unlink_control_failed", err },
        "DELETE /api/policies/:id/controls/:controlId failed"
      );
      res.status(500).json({ error: "policy_unlink_control_failed" });
    }
  }
);

export default router;
