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
 *   POST   /api/vendors                  — create vendor
 *   GET    /api/vendors                  — list vendors (active only by default)
 *   GET    /api/vendors/:id              — get single vendor
 *   PATCH  /api/vendors/:id              — update vendor fields (supports archiving)
 *   GET    /api/vendors/:id/risk-score   — compute + persist vendor risk score
 *   GET    /api/vendors/:id/findings     — findings linked to vendor via assessments
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
import { csvRow } from "../lib/csvExport.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { assetRegistryEnabled } from "../lib/assetRegistryFeatureFlag.js";
import { registerAsset } from "../lib/assetRegistrar.js";
import {
  backingIdsOf,
  normalizeAssetSearchTerm,
  resolveAssetSearch
} from "../lib/assetSearchResolver.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { asTenant } from "../middleware/asTenant.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { requirePremiumOrCorePlatform } from "../lib/corePlatformCapability.js";
import { enforceEntityLimit } from "../lib/entityLimit.js";
import {
  validateVendorCreate,
  validateVendorPatch
} from "../lib/vendorValidation.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  VENDOR_HISTORY_SPEC,
  fetchResourceHistory,
  isHistoryUuid,
  parseHistoryLimit,
  parseHistoryOffset,
} from "../lib/resourceHistory.js";
import { sqlFindingActive } from "../lib/metricDefinitions.js";
import { recomputeAndPersistVendorRiskScore } from "../lib/vendorRiskScoreRecompute.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const VALID_STATUS_FILTERS = new Set(["active", "archived"]);
const VALID_CRITICALITY_FILTERS = new Set(["critical", "high", "medium", "low"]);

const VENDOR_SELECT = `
  id,
  organization_id,
  name,
  service_description,
  category,
  criticality,
  current_risk_score,
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

/**
 * The criticality breakdown for a population with no members.
 *
 * A genuine zero is an ANSWER and must be shaped exactly like a non-zero one:
 * the search-miss early return below would otherwise omit the aggregate keys
 * entirely, and a caller reading `by_criticality.critical` would get
 * `undefined` — which renders as blank or NaN, not as the 0 it actually is.
 */
function emptyCriticalityCounts(): {
  critical: number;
  high: number;
  medium: number;
  low: number;
  uncategorized: number;
} {
  return { critical: 0, high: 0, medium: 0, low: 0, uncategorized: 0 };
}

/* =========================================================
   POST /api/vendors
   Create a vendor for the requesting organization.
   ========================================================= */

router.post(
  "/vendors",
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

      const validated = validateVendorCreate(req.body);
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
          if (assetRegistryEnabled()) {
            await registerAsset(organizationId, "vendor", "vendors", (created.rows[0] as { id: string }).id);
          }
          result = created;
        }
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
  })
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

      // ?reviewed=never — vendors with NO review on record (last_reviewed_at
      // IS NULL): the factual TPRM audit slice, needing no cadence policy.
      // A due-for-review filter (cadence-based) is a separate product ruling
      // and deliberately not implied here.
      const filterReviewed = isNonEmptyString(req.query.reviewed)
        ? req.query.reviewed
        : null;
      if (filterReviewed !== null) {
        if (filterReviewed !== "never") {
          res.status(400).json({
            error: "invalid_reviewed_filter",
            allowed: ["never"]
          });
          return;
        }
        conditions.push("last_reviewed_at IS NULL");
      }

      // Shared asset-search q — the platform capability (name, alias, exact
      // UUID, any registry identifier), narrowed to vendor-typed assets and
      // applied by BACKING id, so this list never re-implements matching.
      const rawQ = req.query.q;
      if (rawQ !== undefined && !(typeof rawQ === "string" && rawQ.trim().length === 0)) {
        const searchTerm = normalizeAssetSearchTerm(rawQ);
        if (searchTerm === null) {
          res.status(400).json({ error: "invalid_search" });
          return;
        }
        const resolved = await resolveAssetSearch(pg, organizationId, searchTerm, {
          assetTypes: ["vendor"]
        });
        const vendorIds = backingIdsOf(resolved.matches, "vendors");
        if (vendorIds.length === 0) {
          res.status(200).json({
            count: 0,
            limit,
            total: 0,
            by_criticality: emptyCriticalityCounts(),
            // A genuine zero, shaped exactly like a non-zero one — see
            // emptyCriticalityCounts(). Omitting the key here would reach the
            // caller as `undefined`, which every honest caller must read as
            // "unknown", and an empty search result is not unknown.
            never_assessed_count: 0,
            organizationId,
            statusFilter: filterStatus,
            nextCursor: null,
            vendors: []
          });
          return;
        }
        params.push(vendorIds);
        conditions.push(`id = ANY($${params.length}::uuid[])`);
      }

      // Snapshot the filter set BEFORE the cursor + limit params, so the
      // aggregates below describe the SAME population as the list and are
      // untouched by paging — the identical discipline GET /api/actions and
      // GET /api/findings already use for their `total`.
      //
      // This is the whole point of the contract: `count` is the length of the
      // returned slice and always was, so a caller that needed the size of the
      // register had nothing to read and could only count rows it had been
      // given — capped at MAX_LIMIT. A cap counted as if it were a population
      // is not a small error, it is a confident wrong number, and it silently
      // stops being wrong only for orgs small enough not to notice.
      const preCursorConditions = [...conditions];
      const preCursorParams = [...params];

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

      // Per-vendor finding counts, computed HERE, in the database.
      //
      // The vendor list and the vendor risk board used to fetch the org's Vendor
      // Risk findings with `limit: 100` and group them by vendor in the browser.
      // Past 100 such findings in the org, a vendor's findings fell off the end of
      // the page before the grouping ever saw them — and the card printed no badge
      // at all for a vendor that had open findings. A truncation is not a zero, and
      // a count derived from a bounded page is a cap wearing a count's clothes.
      //
      // Findings link to the ASSESSMENT (source_id = vendor_assessments.id), never
      // to the vendor directly — the vendor is reached through the join, the same
      // linkage GET /api/vendors/:id/findings uses.
      //
      // Both populations are returned: active_findings_count is the canonical
      // enterprise metric (operational_status <> 'closed'); open_findings_count is
      // the strictly-open population these surfaces display today.
      const findingCounts = (predicate: string) => `
        (SELECT COUNT(*)
           FROM findings f
           JOIN vendor_assessments va
             ON va.id::text = f.source_id::text
            AND f.source_type = 'vendor_review'
          WHERE va.vendor_id = vendors.id
            AND va.organization_id = vendors.organization_id
            AND f.organization_id = vendors.organization_id
            AND ${predicate})::int
      `;

      // Per-vendor ASSESSMENT state, computed HERE, in the database.
      //
      // "Has this vendor ever been assessed?" was answered in the browser by
      // fetching GET /api/vendor-assessments?limit=100 — the ORG's assessments,
      // capped — and asking whether the vendor appeared in it. Past 100
      // assessments in the org, an assessed vendor's rows fell off the end of
      // that page and the vendor rendered as "Never assessed", which on
      // /vendors/risk also gave it a red border and pushed it into Requires
      // Attention. Absence from a capped page is not absence from the table.
      //
      // The predicate is deliberately the one the app already used and the one
      // customers already understand: ANY row in vendor_assessments for this
      // vendor in this org. No status, type, or recency qualifier is implied,
      // because GET /api/vendor-assessments applies none. `last_reviewed_at` is
      // a DIFFERENT metric and is not substituted here.
      const assessmentScope = `
        FROM vendor_assessments va
         WHERE va.vendor_id = vendors.id
           AND va.organization_id = vendors.organization_id
      `;

      const result = await pg.query(
        `
        SELECT ${VENDOR_SELECT},
               ${findingCounts("f.status = 'open'")}                  AS open_findings_count,
               ${findingCounts(sqlFindingActive("f.operational_status"))} AS active_findings_count,
               (SELECT COUNT(*) ${assessmentScope})::int              AS assessment_count,
               -- The date the surfaces print as "Last Assessment". Ordered the
               -- way the capped list it replaces was ordered (created_at DESC,
               -- id DESC) and reading the same column, so un-capping the value
               -- does not quietly redefine which assessment it refers to.
               (SELECT va.performed_at ${assessmentScope}
                 ORDER BY va.created_at DESC, va.id DESC
                 LIMIT 1)                                             AS latest_assessment_at
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

      // Exact aggregates over the SAME filter set (cursor + limit excluded).
      // One extra query, served by idx_vendors_org_status /
      // idx_vendors_org_criticality — the same index path the list itself uses.
      const aggregateRow = await pg.query<{
        total: string;
        critical: string;
        high: string;
        medium: string;
        low: string;
        uncategorized: string;
        never_assessed: string;
      }>(
        `
        SELECT
          COUNT(*)                                                     AS total,
          COUNT(*) FILTER (WHERE criticality = 'critical')             AS critical,
          COUNT(*) FILTER (WHERE criticality = 'high')                 AS high,
          COUNT(*) FILTER (WHERE criticality = 'medium')               AS medium,
          COUNT(*) FILTER (WHERE criticality = 'low')                  AS low,
          -- NULL and any value outside the four known bands, so the parts
          -- always sum to total. A vendor with an unrecognised criticality
          -- must appear SOMEWHERE in the breakdown rather than vanish from it.
          COUNT(*) FILTER (
            WHERE criticality IS NULL
               OR criticality NOT IN ('critical', 'high', 'medium', 'low')
          )                                                            AS uncategorized,
          -- Vendors with NO assessment on record, over the SAME filtered
          -- population as total. The surfaces that print "Need Assessment"
          -- counted this by scanning a ≤100-row page against a ≤100-row
          -- assessment page — two caps multiplied, presented as a total.
          -- Same predicate as assessment_count above, so the tile and the rows
          -- beneath it cannot disagree.
          COUNT(*) FILTER (
            WHERE NOT EXISTS (
              SELECT 1
                FROM vendor_assessments va
               WHERE va.vendor_id = vendors.id
                 AND va.organization_id = vendors.organization_id
            )
          )                                                            AS never_assessed
        FROM vendors
        WHERE ${preCursorConditions.join(" AND ")}
        `,
        preCursorParams
      );

      const agg = aggregateRow.rows[0];
      const total = parseInt(agg?.total ?? "0", 10);
      const byCriticality = {
        critical:      parseInt(agg?.critical ?? "0", 10),
        high:          parseInt(agg?.high ?? "0", 10),
        medium:        parseInt(agg?.medium ?? "0", 10),
        low:           parseInt(agg?.low ?? "0", 10),
        uncategorized: parseInt(agg?.uncategorized ?? "0", 10),
      };
      const neverAssessedCount = parseInt(agg?.never_assessed ?? "0", 10);

      const vendors = result.rows;
      const last = vendors.length > 0 ? vendors[vendors.length - 1] : null;

      res.status(200).json({
        count: vendors.length,
        limit,
        // Additive: `count` keeps its meaning (the slice length) so every
        // existing caller is unaffected. `total` and `by_criticality` describe
        // the whole matching population.
        total,
        by_criticality: byCriticality,
        // Exact over the same population as `total` — never a tally of the
        // returned slice, and never derived from `last_reviewed_at`.
        never_assessed_count: neverAssessedCount,
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
  })
);

/* =========================================================
   GET /api/vendors/summary
   Aggregate risk counts for vendors scoped to the org.
   ========================================================= */

router.get(
  "/vendors/summary",
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
              WHERE ${sqlFindingActive("f.operational_status")}
            )                                                                AS open_findings,
            COUNT(f.id) FILTER (
              WHERE ${sqlFindingActive("f.operational_status")}
                AND f.severity = 'Critical'
            )                                                                AS critical_findings,
            COUNT(f.id) FILTER (
              WHERE ${sqlFindingActive("f.operational_status")}
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
  })
);

/* =========================================================
   GET /api/vendors/export.csv
   CSV export of all org vendors with optional filters.
   ========================================================= */

// CSV serialization migrated to the shared lib (src/api/lib/csvExport.ts) so
// every register export escapes identically.

router.get(
  "/vendors/export.csv",
  requireApiKey,
  attachOrganizationContext,
  requirePremiumOrCorePlatform,
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
         ORDER BY created_at DESC, id DESC
         LIMIT 10000`,
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

/* =========================================================
   GET /api/vendors/:id
   Get a single vendor by ID. Returns 404 if the vendor does
   not exist or belongs to a different organization.
   ========================================================= */

router.get(
  "/vendors/:id",
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
  })
);

/* =========================================================
   GET /api/vendors/:id/history
   Per-vendor audit trail — the RR-3 per-risk history pattern
   generalized via src/api/lib/resourceHistory.ts. Events on the
   vendor plus its assessments, reviews, and assurance documents,
   newest first, mirroring the GET /api/audit-log field shape.

   Auth mirrors GET /api/vendors/:id (no admin gate) — anyone who
   can read the vendor can read its history.
   ========================================================= */

router.get(
  "/vendors/:id/history",
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

    const vendorId = String(req.params.id ?? "").trim();
    if (!vendorId) {
      res.status(400).json({ error: "vendor_id_required" });
      return;
    }
    if (!isHistoryUuid(vendorId)) {
      res.status(400).json({ error: "vendor_id_must_be_uuid" });
      return;
    }

    const limit  = parseHistoryLimit(req.query.limit);
    const offset = parseHistoryOffset(req.query.offset);

    try {
      // Ownership first: cross-org probes must 404 (an empty events
      // list for a foreign id would leak existence by absence).
      const ownership = await pg.query(
        `SELECT 1 FROM vendors WHERE id = $1 AND organization_id = $2`,
        [vendorId, organizationId]
      );
      if ((ownership.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "vendor_not_found" });
        return;
      }

      const page = await fetchResourceHistory(
        VENDOR_HISTORY_SPEC,
        organizationId,
        vendorId,
        limit,
        offset
      );
      res.status(200).json(page);
    } catch (err) {
      logger.error(
        { event: "vendor_history_failed", err, vendorId },
        "GET /api/vendors/:id/history failed"
      );
      res.status(500).json({ error: "vendor_history_failed" });
    }
  })
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
  requirePremiumOrCorePlatform,
  asTenant(async (req, res) => {
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
  })
);

/* =========================================================
   GET /api/vendors/:id/risk-score
   Compute and persist the risk score for a single vendor.
   Returns the computed score, risk_level, and contributing inputs.
   ========================================================= */

router.get(
  "/vendors/:id/risk-score",
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

      const vendorId = String(req.params.id ?? "").trim();
      if (!vendorId) {
        res.status(400).json({ error: "vendor_id_required" });
        return;
      }

      const vendorResult = await pg.query<{ criticality: string | null }>(
        `SELECT criticality FROM vendors WHERE id = $1 AND organization_id = $2`,
        [vendorId, organizationId]
      );
      if ((vendorResult.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "vendor_not_found" });
        return;
      }

      // Shared recompute (vendorRiskScoreRecompute.ts) — the same canonical
      // finding union and persist every automatic refresh path now uses, so
      // "Recalculate" can never disagree with the hooks.
      const recomputed = await recomputeAndPersistVendorRiskScore(
        organizationId,
        vendorId
      );
      if (recomputed === null) {
        res.status(404).json({ error: "vendor_not_found" });
        return;
      }

      res.status(200).json({
        vendor_id: vendorId,
        score: recomputed.score,
        risk_level: recomputed.risk_level,
        finding_count: recomputed.finding_count,
        criticality: recomputed.criticality,
        computed_at: new Date().toISOString(),
      });
    } catch (err) {
      logger.error({ event: "vendor_risk_score_failed", err }, "GET /api/vendors/:id/risk-score failed");
      res.status(500).json({ error: "vendor_risk_score_failed" });
    }
  })
);

/* =========================================================
   GET /api/vendors/:id/findings
   Fetch all findings linked to a vendor via assessments and
   review cycles. Unions vendor_review and vendor_cycle_review
   source types so both workflows are represented.
   ========================================================= */

const VALID_FINDING_STATUSES = new Set(["open", "in_progress", "resolved", "accepted"]);

router.get(
  "/vendors/:id/findings",
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

      const vendorId = String(req.params.id ?? "").trim();
      if (!vendorId) {
        res.status(400).json({ error: "vendor_id_required" });
        return;
      }

      const limit = Math.min(parseLimit(req.query.limit ?? 50), 100);
      const filterStatus = isNonEmptyString(req.query.status)
        ? (req.query.status as string).trim()
        : null;

      if (filterStatus !== null && !VALID_FINDING_STATUSES.has(filterStatus)) {
        res.status(400).json({ error: "invalid_status_filter", allowed: [...VALID_FINDING_STATUSES] });
        return;
      }

      const params: unknown[] = [vendorId, organizationId];
      let statusClause = "";
      if (filterStatus !== null) {
        params.push(filterStatus);
        statusClause = `AND f.status = $${params.length}`;
      }
      params.push(limit);
      const limitParam = params.length;

      const result = await pg.query<{
        id: string;
        title: string;
        severity: string;
        status: string;
        domain: string | null;
        description: string | null;
        created_at: string;
        updated_at: string;
        assessment_id: string;
        assessment_type: string;
        performed_at: string | null;
      }>(
        `
        SELECT
          f.id,
          f.title,
          f.severity,
          f.status,
          f.domain,
          f.description,
          f.created_at,
          f.updated_at,
          va.id              AS assessment_id,
          va.assessment_type AS assessment_type,
          va.performed_at    AS performed_at
        FROM findings f
        JOIN vendor_assessments va
          ON va.id::text = f.source_id::text
          AND f.source_type = 'vendor_review'
        WHERE va.vendor_id = $1
          AND f.organization_id = $2
          ${statusClause}

        UNION ALL

        SELECT
          f.id,
          f.title,
          f.severity,
          f.status,
          f.domain,
          f.description,
          f.created_at,
          f.updated_at,
          vr.id                 AS assessment_id,
          'vendor_cycle_review' AS assessment_type,
          vr.performed_at       AS performed_at
        FROM findings f
        JOIN vendor_reviews vr
          ON vr.id::text = f.source_id::text
          AND f.source_type = 'vendor_cycle_review'
        WHERE vr.vendor_id = $1
          AND f.organization_id = $2
          ${statusClause}

        ORDER BY created_at DESC
        LIMIT $${limitParam}
        `,
        params
      );

      res.status(200).json({
        findings: result.rows,
        total: result.rowCount ?? 0,
      });
    } catch (err) {
      logger.error({ event: "vendor_findings_failed", err }, "GET /api/vendors/:id/findings failed");
      res.status(500).json({ error: "vendor_findings_failed" });
    }
  })
);

export default router;
