/**
 * vendors.ts — Vendor risk primitives API
 *
 * Vendors are a first-class platform primitive: they represent third parties
 * the organization depends on. Every vendor record is org-scoped. Findings
 * originating from vendor reviews reference the vendor via source_type =
 * 'vendor_review' and source_id = vendors.id (convention, not FK — the
 * source_id column on findings is polymorphic).
 *
 * Routes:
 *   POST   /api/vendors           — create vendor
 *   GET    /api/vendors           — list vendors (active only by default)
 *   GET    /api/vendors/:id       — get single vendor
 *   PATCH  /api/vendors/:id       — update vendor fields (supports archiving)
 *
 * No hard-delete route. Vendors are archived via PATCH status=archived.
 * Hard delete is deferred: assessments hold vendor_id FKs (ON DELETE SET NULL)
 * and archiving preserves historical context for those records.
 *
 * All routes use the standard middleware chain.
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import {
  validateVendorCreate,
  validateVendorPatch
} from "../lib/vendorValidation.js";
import { writeAuditEvent } from "../lib/auditLog.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const VALID_STATUS_FILTERS = new Set(["active", "archived"]);
const VALID_CRITICALITY_FILTERS = new Set(["critical", "high", "medium", "low"]);

// Columns returned from all vendor queries.
// current_risk_score and framework_coverage are deliberately excluded:
// they are legacy pre-platform fields. Vendor risk will be derived from
// findings in a later package.
const VENDOR_SELECT = `
  id,
  organization_id,
  name,
  service_description,
  category,
  criticality,
  data_sensitivity,
  access_level,
  website,
  status,
  owner_user_id,
  last_reviewed_at,
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
   POST /api/vendors
   Create a vendor for the requesting organization.
   ========================================================= */

router.post(
  "/vendors",
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

      const validated = validateVendorCreate(req.body);
      if ("error" in validated) {
        res.status(400).json(validated);
        return;
      }

      const { input } = validated;

      let result;
      try {
        result = await pg.query(
          `
          INSERT INTO vendors (
            organization_id,
            name,
            service_description,
            category,
            criticality,
            data_sensitivity,
            access_level,
            website,
            owner_user_id,
            status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
          RETURNING ${VENDOR_SELECT}
          `,
          [
            organizationId,
            input.name,
            input.service_description ?? null,
            input.category ?? null,
            input.criticality ?? null,
            input.data_sensitivity ?? null,
            input.access_level ?? null,
            input.website ?? null,
            input.owner_user_id ?? (req as any).autoUserId ?? null
          ]
        );
      } catch (err: any) {
        if (err?.code === "23505") {
          res.status(409).json({
            error: "vendor_name_already_exists",
            name: input.name
          });
          return;
        }
        throw err;
      }

      logger.info(
        {
          event: "vendor_created",
          organizationId,
          vendorId: result.rows[0]?.id,
          name: input.name
        },
        "Vendor created"
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId: req.userId ?? null,
        eventType: "vendor.created",
        resourceType: "vendor",
        resourceId: result.rows[0].id as string,
        payload: { name: input.name, criticality: input.criticality ?? null },
        ipAddress: req.ip ?? null
      });

      res.status(201).json({ vendor: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "vendor_create_failed", err },
        "POST /api/vendors failed"
      );
      res.status(500).json({ error: "vendor_create_failed" });
    }
  }
);

/* =========================================================
   GET /api/vendors
   List vendors for the requesting organization.
   Default: active vendors only. Pass ?status=archived to see archived.
   Supports cursor pagination and criticality filter.
   ========================================================= */

router.get(
  "/vendors",
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

      // Status filter: default to active if not provided
      const filterStatus = isNonEmptyString(req.query.status)
        ? req.query.status
        : "active";

      if (!VALID_STATUS_FILTERS.has(filterStatus)) {
        res.status(400).json({
          error: "invalid_status_filter",
          allowed: [...VALID_STATUS_FILTERS]
        });
        return;
      }
      params.push(filterStatus);
      conditions.push(`status = $${params.length}`);

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
        SELECT ${VENDOR_SELECT}
        FROM vendors
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

      const vendors = result.rows;
      const last = vendors.length > 0 ? vendors[vendors.length - 1] : null;

      res.status(200).json({
        count: vendors.length,
        limit,
        organizationId,
        statusFilter: filterStatus,
        nextCursor:
          last != null ? { created_at: last.created_at, id: last.id } : null,
        vendors
      });
    } catch (err) {
      logger.error(
        { event: "vendors_list_failed", err },
        "GET /api/vendors failed"
      );
      res.status(500).json({ error: "vendors_list_failed" });
    }
  }
);

/* =========================================================
   GET /api/vendors/summary
   Aggregate risk counts for vendors scoped to the org.
   ========================================================= */

router.get(
  "/vendors/summary",
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

      const result = await pg.query<{
        total_vendors: string;
        critical_vendors: string;
        high_vendors: string;
        vendors_with_findings: string;
        top_vendors_by_risk: Array<{
          id: string;
          name: string;
          criticality: string | null;
          open_findings: number;
          critical_findings: number;
          high_findings: number;
        }> | null;
      }>(
        `
        WITH vendor_findings AS (
          SELECT
            v.id,
            v.name,
            v.criticality,
            COUNT(f.id) FILTER (
              WHERE f.status = 'open'
            )                                                                AS open_findings,
            COUNT(f.id) FILTER (
              WHERE f.status = 'open'
                AND f.severity = 'Critical'
            )                                                                AS critical_findings,
            COUNT(f.id) FILTER (
              WHERE f.status = 'open'
                AND f.severity = 'High'
            )                                                                AS high_findings
          FROM vendors v
          LEFT JOIN (
            SELECT va.vendor_id, f.id, f.status, f.severity
            FROM findings f
            JOIN vendor_assessments va
              ON va.id = f.source_id
             AND f.source_type = 'vendor_review'
             AND va.organization_id = $1
            UNION ALL
            SELECT vr.vendor_id, f.id, f.status, f.severity
            FROM findings f
            JOIN vendor_reviews vr
              ON vr.id = f.source_id
             AND f.source_type = 'vendor_cycle_review'
             AND vr.organization_id = $1
          ) f ON f.vendor_id = v.id
          WHERE v.organization_id = $1
            AND v.status = 'active'
          GROUP BY v.id, v.name, v.criticality
        )
        SELECT
          COUNT(*)::text                                                     AS total_vendors,
          COUNT(*) FILTER (WHERE criticality = 'critical')::text            AS critical_vendors,
          COUNT(*) FILTER (WHERE criticality = 'high')::text                AS high_vendors,
          COUNT(*) FILTER (WHERE open_findings > 0)::text                   AS vendors_with_findings,
          json_agg(
            json_build_object(
              'id',                id,
              'name',              name,
              'criticality',       criticality,
              'open_findings',     open_findings,
              'critical_findings', critical_findings,
              'high_findings',     high_findings
            ) ORDER BY open_findings DESC NULLS LAST, critical_findings DESC NULLS LAST
          ) FILTER (WHERE open_findings > 0)                                AS top_vendors_by_risk
        FROM vendor_findings
        `,
        [organizationId]
      );

      const row = result.rows[0];
      res.status(200).json({
        summary: {
          total_vendors:        parseInt(row?.total_vendors ?? "0", 10),
          critical_vendors:     parseInt(row?.critical_vendors ?? "0", 10),
          high_vendors:         parseInt(row?.high_vendors ?? "0", 10),
          vendors_with_findings: parseInt(row?.vendors_with_findings ?? "0", 10),
          top_vendors_by_risk:  row?.top_vendors_by_risk ?? [],
        },
      });
    } catch (err) {
      logger.error({ event: "vendors_summary_failed", err }, "GET /api/vendors/summary failed");
      res.status(500).json({ error: "vendors_summary_failed" });
    }
  }
);

/* =========================================================
   GET /api/vendors/:id
   Get a single vendor by ID. Returns 404 if the vendor does
   not exist or belongs to a different organization.
   ========================================================= */

router.get(
  "/vendors/:id",
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

      const vendorId = String(req.params.id ?? "").trim();
      if (!vendorId) {
        res.status(400).json({ error: "vendor_id_required" });
        return;
      }

      const result = await pg.query(
        `
        SELECT ${VENDOR_SELECT}
        FROM vendors
        WHERE id = $1
          AND organization_id = $2
        `,
        [vendorId, organizationId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "vendor_not_found" });
        return;
      }

      res.status(200).json({ vendor: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "vendor_get_failed", err },
        "GET /api/vendors/:id failed"
      );
      res.status(500).json({ error: "vendor_get_failed" });
    }
  }
);

/* =========================================================
   PATCH /api/vendors/:id
   Update vendor fields. Supports archiving via status=archived.
   Returns 404 if the vendor does not belong to the org.
   At least one updatable field must be present.
   ========================================================= */

router.patch(
  "/vendors/:id",
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

      const vendorId = String(req.params.id ?? "").trim();
      if (!vendorId) {
        res.status(400).json({ error: "vendor_id_required" });
        return;
      }

      const validated = validateVendorPatch(req.body);
      if ("error" in validated) {
        res.status(400).json(validated);
        return;
      }

      const { input } = validated;

      // Build dynamic SET clause from validated input fields
      const updates: string[] = [];
      const values: unknown[] = [];

      if ("name" in input) {
        values.push(input.name);
        updates.push(`name = $${values.length}`);
      }

      if ("service_description" in input) {
        values.push(input.service_description ?? null);
        updates.push(`service_description = $${values.length}`);
      }

      if ("category" in input) {
        values.push(input.category ?? null);
        updates.push(`category = $${values.length}`);
      }

      if ("criticality" in input) {
        values.push(input.criticality ?? null);
        updates.push(`criticality = $${values.length}`);
      }

      if ("data_sensitivity" in input) {
        values.push(input.data_sensitivity ?? null);
        updates.push(`data_sensitivity = $${values.length}`);
      }

      if ("access_level" in input) {
        values.push(input.access_level ?? null);
        updates.push(`access_level = $${values.length}`);
      }

      if ("website" in input) {
        values.push(input.website ?? null);
        updates.push(`website = $${values.length}`);
      }

      if ("owner_user_id" in input) {
        values.push(input.owner_user_id ?? null);
        updates.push(`owner_user_id = $${values.length}`);
      }

      if ("status" in input) {
        values.push(input.status);
        updates.push(`status = $${values.length}`);
      }

      // Append scoping params
      values.push(vendorId, organizationId);
      const idParam = values.length - 1;
      const orgParam = values.length;

      let result;
      try {
        result = await pg.query(
          `
          UPDATE vendors
          SET ${updates.join(", ")}, updated_at = NOW()
          WHERE id = $${idParam}
            AND organization_id = $${orgParam}
          RETURNING ${VENDOR_SELECT}
          `,
          values
        );
      } catch (err: any) {
        if (err?.code === "23505") {
          res.status(409).json({
            error: "vendor_name_already_exists",
            name: input.name
          });
          return;
        }
        throw err;
      }

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "vendor_not_found" });
        return;
      }

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId: req.userId ?? null,
        eventType: "vendor.updated",
        resourceType: "vendor",
        resourceId: vendorId,
        payload: { fields: Object.keys(input) },
        ipAddress: req.ip ?? null
      });

      res.status(200).json({ vendor: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "vendor_patch_failed", err },
        "PATCH /api/vendors/:id failed"
      );
      res.status(500).json({ error: "vendor_patch_failed" });
    }
  }
);

/* =========================================================
   GET /api/vendors/export.csv
   CSV export of all org vendors with optional filters.
   ========================================================= */

function csvCell(val: string | null | undefined): string {
  const s = val == null ? "" : String(val);
  return `"${s.replace(/"/g, '""')}"`;
}

function csvRow(cells: Array<string | null | undefined>): string {
  return cells.map(csvCell).join(",");
}

router.get(
  "/vendors/export.csv",
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

    const conditions: string[] = ["organization_id = $1"];
    const params: unknown[] = [organizationId];

    const qStatus = isNonEmptyString(req.query.status) ? req.query.status.trim() : null;
    if (qStatus !== null) {
      if (!VALID_STATUS_FILTERS.has(qStatus)) {
        res.status(400).json({ error: "invalid_status_filter", allowed: [...VALID_STATUS_FILTERS] });
        return;
      }
      params.push(qStatus);
      conditions.push(`status = $${params.length}`);
    }

    const qCriticality = isNonEmptyString(req.query.criticality) ? req.query.criticality.trim() : null;
    if (qCriticality !== null) {
      if (!VALID_CRITICALITY_FILTERS.has(qCriticality)) {
        res.status(400).json({ error: "invalid_criticality_filter", allowed: [...VALID_CRITICALITY_FILTERS] });
        return;
      }
      params.push(qCriticality);
      conditions.push(`criticality = $${params.length}`);
    }

    const where = conditions.join(" AND ");

    try {
      const result = await pg.query<{
        id: string;
        name: string;
        category: string | null;
        criticality: string | null;
        status: string | null;
        data_sensitivity: string | null;
        access_level: string | null;
        website: string | null;
        service_description: string | null;
        created_at: string;
        last_reviewed_at: string | null;
      }>(
        `SELECT id, name, category, criticality, status, data_sensitivity,
                access_level, website, service_description, created_at, last_reviewed_at
         FROM vendors
         WHERE ${where}
         ORDER BY created_at DESC, id DESC`,
        params
      );

      writeAuditEvent({
        organizationId: organizationId,
        actorUserId:    req.userId ?? null,
        actorApiKeyId:  (req as any).apiKey?.id ?? null,
        eventType:      "data.exported",
        resourceType:   "vendor",
        payload:        { format: "csv", record_count: result.rows.length, entity: "vendors" },
        ipAddress:      req.ip ?? null
      });

      const fileDate = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="vendors-${fileDate}.csv"`);

      const header = csvRow([
        "ID", "Name", "Category", "Criticality", "Status",
        "Data Sensitivity", "Access Level", "Website",
        "Description", "Last Reviewed", "Created At"
      ]);
      res.write(header + "\r\n");

      for (const row of result.rows) {
        const line = csvRow([
          row.id,
          row.name,
          row.category,
          row.criticality,
          row.status,
          row.data_sensitivity,
          row.access_level,
          row.website,
          row.service_description,
          row.last_reviewed_at ? new Date(row.last_reviewed_at).toISOString().slice(0, 10) : null,
          new Date(row.created_at).toISOString().slice(0, 10),
        ]);
        res.write(line + "\r\n");
      }

      res.end();
    } catch (err) {
      logger.error({ event: "vendors_export_failed", err }, "GET /api/vendors/export.csv failed");
      res.status(500).json({ error: "vendors_export_failed" });
    }
  }
);

export default router;
