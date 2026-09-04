/**
 * vendorFrameworkProgress.ts — ONE read for "how far is this vendor's assessment
 * against each of our frameworks".
 *
 * Why this exists. The vendor detail page answered that question with
 * `GET /frameworks` and then `GET /frameworks/:id/requirements?subject_id=v`
 * once PER activated framework, then kept only the frameworks where the
 * vendor's assessment had started. With six frameworks that was seven engine
 * calls per page render — of eighteen in total — and the per-render cost grew
 * with every framework a customer activated. Under the per-session limiter
 * (120/min) an analyst working relationship → contact → intake at ordinary
 * speed reached 429, and the page then behaved as if the vendor were gone.
 *
 * This route returns the SAME numbers the requirements route computes
 * (total / pass / partial / fail / not_assessed / progress_pct /
 * last_response_at — see requirements.ts, "summary"), for every framework of
 * the caller's organisation where THIS vendor has at least one recorded
 * response, in one tenant-scoped query. It is deliberately narrow: no
 * requirement rows, no responses, no other subject, no other vendor. The
 * per-framework requirements read is untouched and remains the surface for
 * the questionnaire itself.
 *
 * Tenant boundary: the vendor must belong to the caller's organisation (404
 * otherwise — never a hint), frameworks are selected by organization_id, and
 * responses are joined on (organization_id, assessment_type='vendor',
 * subject_id = this vendor). Same guards as the two reads it replaces.
 */

import { Router } from "express";
import type { Request, Response } from "express";

import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { asTenant } from "../middleware/asTenant.js";
import { assessmentProgress } from "../lib/frameworkCoverage.js";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type VendorFrameworkProgressRow = {
  framework_id: string;
  framework_name: string;
  framework_version: string;
  total: string;
  pass: string;
  partial: string;
  fail: string;
  last_response_at: Date | string | null;
};

export type VendorFrameworkProgressEntry = {
  framework: { id: string; name: string; version: string };
  summary: {
    total: number;
    pass: number;
    partial: number;
    fail: number;
    not_assessed: number;
    /** 0–100 completion share — assessment progress, never readiness (O-5). */
    progress_pct: number;
    last_response_at: string | null;
  };
};

/** Pure projection of a query row into the response shape (unit-testable). */
export function projectProgressRow(row: VendorFrameworkProgressRow): VendorFrameworkProgressEntry {
  const total = Number(row.total);
  const pass = Number(row.pass);
  const partial = Number(row.partial);
  const fail = Number(row.fail);
  const assessed = pass + partial + fail;
  const last =
    row.last_response_at === null
      ? null
      : new Date(row.last_response_at as unknown as string).toISOString();
  return {
    framework: { id: row.framework_id, name: row.framework_name, version: row.framework_version },
    summary: {
      total,
      pass,
      partial,
      fail,
      not_assessed: total - assessed,
      progress_pct: assessmentProgress(assessed, total),
      last_response_at: last,
    },
  };
}

/* =========================================================
   GET /api/vendors/:id/framework-progress
   ========================================================= */

router.get(
  "/vendors/:id/framework-progress",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(async (req: Request, res: Response) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId: string | null = organizationContext?.organizationId ?? null;
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const vendorId = String(req.params["id"] ?? "").trim();
    if (!UUID_RE.test(vendorId)) {
      res.status(404).json({ error: "vendor_not_found" });
      return;
    }

    try {
      const owned = await pg.query<{ id: string }>(
        `SELECT id FROM vendors WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [vendorId, organizationId]
      );
      if ((owned.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "vendor_not_found" });
        return;
      }

      // One query. `assessed` counts a response whose status is pass/partial/
      // fail — a stored `not_assessed` counts as unassessed, exactly as the
      // per-framework requirements summary counts it.
      const result = await pg.query<VendorFrameworkProgressRow>(
        `
        SELECT
          f.id                                              AS framework_id,
          f.name                                            AS framework_name,
          f.version                                         AS framework_version,
          COUNT(r.id)                                       AS total,
          COUNT(rr.id) FILTER (WHERE rr.status = 'pass')    AS pass,
          COUNT(rr.id) FILTER (WHERE rr.status = 'partial') AS partial,
          COUNT(rr.id) FILTER (WHERE rr.status = 'fail')    AS fail,
          MAX(rr.assessed_at)                               AS last_response_at
        FROM frameworks f
        JOIN requirements r
          ON r.framework_id = f.id
        LEFT JOIN requirement_responses rr
          ON rr.requirement_id  = r.id
         AND rr.organization_id = $1
         AND rr.assessment_type = 'vendor'
         AND rr.subject_id      = $2::uuid
        WHERE f.organization_id = $1
        GROUP BY f.id, f.name, f.version
        HAVING COUNT(rr.id) FILTER (WHERE rr.status IN ('pass', 'partial', 'fail')) > 0
        ORDER BY f.name ASC, f.version ASC, f.id ASC
        `,
        [organizationId, vendorId]
      );

      res.status(200).json({
        vendor_id: vendorId,
        frameworks: result.rows.map(projectProgressRow),
      });
    } catch (err) {
      logger.error(
        { event: "vendor_framework_progress_failed", err, organizationId, vendorId },
        "GET /api/vendors/:id/framework-progress failed"
      );
      res.status(500).json({ error: "vendor_framework_progress_failed" });
    }
  })
);

export default router;
