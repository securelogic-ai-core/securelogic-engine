/**
 * signalVendorLinks.ts — Tenant-scoped linkage between cyber_signals and vendors.
 *
 * The narrowest correct slice of BUILD_SEQUENCE.md Priority 5
 * (signal-to-platform-linkage). Vendor-only by design. Future packages will
 * extend the same pattern to AI systems, controls, obligations, risks, and
 * findings — and only after this pattern is confirmed in production.
 *
 * ROUTES
 *   POST   /api/signal-vendor-links          — create a link
 *   DELETE /api/signal-vendor-links/:id      — soft-delete a link (deleted_at)
 *   GET    /api/vendors/:id/signals          — signals linked to a vendor
 *   GET    /api/cyber-signals/:id/vendors    — vendors linked to a signal
 *
 * TENANT RULES (TENANT_ISOLATION_STANDARD.md §1, §4, §8)
 *   - organization_id is sourced from req.organizationContext, never from the
 *     request body or any user-supplied parameter.
 *   - Vendor must belong to the requesting org. Cross-org returns 404, not 403,
 *     to avoid enumeration.
 *   - Signal must belong to the requesting org OR be a global signal
 *     (cyber_signals.organization_id IS NULL); global signals are explicitly
 *     cross-org-visible per §1.
 *   - Audit-log every create and delete via writeAuditEvent.
 *
 * NOT IN SCOPE FOR THIS PACKAGE
 *   - Auto-linking from cyberSignalProcessingService (the existing fuzzy
 *     vendor matcher continues to operate independently and is not modified).
 *   - Bulk endpoints, backfill, posture/brief surfacing, UI work.
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  validateSignalVendorLinkCreate,
  isUuid
} from "../lib/signalVendorLinkValidation.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const LINK_SELECT = `
  id,
  organization_id,
  signal_id,
  vendor_id,
  note,
  created_by_user_id,
  created_at,
  deleted_at
`;

const SIGNAL_SELECT = `
  id,
  organization_id,
  source,
  signal_type,
  severity,
  normalized_summary,
  affected_vendor,
  affected_cve,
  ingestion_timestamp,
  processed,
  created_at
`;

const VENDOR_SELECT = `
  id,
  organization_id,
  name,
  criticality,
  status,
  created_at
`;

function parseLimit(value: unknown): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function getOrgId(req: Request): string | null {
  const ctx = (req as unknown as {
    organizationContext?: { organizationId?: string };
  }).organizationContext;
  return ctx?.organizationId ?? null;
}

/* =========================================================
   POST /api/signal-vendor-links
   Create a tenant-scoped link between a cyber signal and a vendor.

   Idempotent on (organization_id, signal_id, vendor_id) where
   deleted_at IS NULL — second call returns the existing live row.
   ========================================================= */

router.post(
  "/signal-vendor-links",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req: Request, res: Response) => {
    const organizationId = getOrgId(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const validated = validateSignalVendorLinkCreate(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { signal_id, vendor_id, note } = validated.input;

    try {
      // Pre-flight: vendor must belong to this org. 404 not 403 — no enumeration.
      const vendorCheck = await pg.query(
        `SELECT 1 FROM vendors WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [vendor_id, organizationId]
      );
      if ((vendorCheck.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "vendor_not_found" });
        return;
      }

      // Pre-flight: signal must be same-org OR global (organization_id IS NULL).
      const signalCheck = await pg.query(
        `SELECT 1 FROM cyber_signals
          WHERE id = $1
            AND (organization_id = $2 OR organization_id IS NULL)
          LIMIT 1`,
        [signal_id, organizationId]
      );
      if ((signalCheck.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "cyber_signal_not_found" });
        return;
      }

      // Idempotent insert. If a live row exists, return it.
      const existing = await pg.query(
        `SELECT ${LINK_SELECT}
           FROM signal_vendor_links
          WHERE organization_id = $1
            AND signal_id = $2
            AND vendor_id = $3
            AND deleted_at IS NULL
          LIMIT 1`,
        [organizationId, signal_id, vendor_id]
      );

      if ((existing.rowCount ?? 0) > 0) {
        res.status(200).json({ link: existing.rows[0], created: false });
        return;
      }

      const insertResult = await pg.query(
        `INSERT INTO signal_vendor_links (
           organization_id, signal_id, vendor_id, note, created_by_user_id
         )
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${LINK_SELECT}`,
        [organizationId, signal_id, vendor_id, note, req.userId ?? null]
      );

      const link = insertResult.rows[0];

      logger.info(
        {
          event: "signal_vendor_link_created",
          organizationId,
          linkId: link.id,
          signalId: signal_id,
          vendorId: vendor_id
        },
        "Signal-vendor link created"
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as unknown as { apiKey?: { id?: string } }).apiKey?.id ?? null,
        actorUserId: req.userId ?? null,
        eventType: "signal_vendor_link.created",
        resourceType: "signal_vendor_link",
        resourceId: link.id as string,
        payload: { signal_id, vendor_id },
        ipAddress: req.ip ?? null
      });

      res.status(201).json({ link, created: true });
    } catch (err) {
      logger.error(
        { event: "signal_vendor_link_create_failed", err },
        "POST /api/signal-vendor-links failed"
      );
      res.status(500).json({ error: "signal_vendor_link_create_failed" });
    }
  }
);

/* =========================================================
   DELETE /api/signal-vendor-links/:id
   Soft-delete a link belonging to the requesting organization.
   ========================================================= */

router.delete(
  "/signal-vendor-links/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req: Request, res: Response) => {
    const organizationId = getOrgId(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const linkId = String(req.params.id ?? "").trim();
    if (!isUuid(linkId)) {
      res.status(400).json({ error: "link_id_must_be_uuid" });
      return;
    }

    try {
      const result = await pg.query(
        `UPDATE signal_vendor_links
            SET deleted_at = NOW()
          WHERE id = $1
            AND organization_id = $2
            AND deleted_at IS NULL
          RETURNING ${LINK_SELECT}`,
        [linkId, organizationId]
      );

      if ((result.rowCount ?? 0) === 0) {
        // Cross-org link, non-existent id, or already-deleted — return 404
        // uniformly to avoid enumeration.
        res.status(404).json({ error: "signal_vendor_link_not_found" });
        return;
      }

      const link = result.rows[0];

      logger.info(
        {
          event: "signal_vendor_link_deleted",
          organizationId,
          linkId: link.id,
          signalId: link.signal_id,
          vendorId: link.vendor_id
        },
        "Signal-vendor link deleted"
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as unknown as { apiKey?: { id?: string } }).apiKey?.id ?? null,
        actorUserId: req.userId ?? null,
        eventType: "signal_vendor_link.deleted",
        resourceType: "signal_vendor_link",
        resourceId: link.id as string,
        payload: {
          signal_id: link.signal_id,
          vendor_id: link.vendor_id
        },
        ipAddress: req.ip ?? null
      });

      res.status(200).json({ link });
    } catch (err) {
      logger.error(
        { event: "signal_vendor_link_delete_failed", err },
        "DELETE /api/signal-vendor-links/:id failed"
      );
      res.status(500).json({ error: "signal_vendor_link_delete_failed" });
    }
  }
);

/* =========================================================
   GET /api/vendors/:id/signals
   List cyber signals linked to a vendor in this organization.
   ========================================================= */

router.get(
  "/vendors/:id/signals",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req: Request, res: Response) => {
    const organizationId = getOrgId(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const vendorId = String(req.params.id ?? "").trim();
    if (!isUuid(vendorId)) {
      res.status(400).json({ error: "vendor_id_must_be_uuid" });
      return;
    }

    try {
      const vendorCheck = await pg.query(
        `SELECT 1 FROM vendors WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [vendorId, organizationId]
      );
      if ((vendorCheck.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "vendor_not_found" });
        return;
      }

      const limit = parseLimit(req.query.limit);

      const result = await pg.query(
        `SELECT
           svl.id           AS link_id,
           svl.note         AS link_note,
           svl.created_at   AS link_created_at,
           ${SIGNAL_SELECT.split(",").map((c) => `cs.${c.trim()}`).join(",\n           ")}
           FROM signal_vendor_links svl
           JOIN cyber_signals cs ON cs.id = svl.signal_id
          WHERE svl.organization_id = $1
            AND svl.vendor_id = $2
            AND svl.deleted_at IS NULL
            AND (cs.organization_id = $1 OR cs.organization_id IS NULL)
          ORDER BY svl.created_at DESC, svl.id DESC
          LIMIT $3`,
        [organizationId, vendorId, limit]
      );

      res.status(200).json({
        count: result.rows.length,
        limit,
        organizationId,
        vendorId,
        signals: result.rows
      });
    } catch (err) {
      logger.error(
        { event: "vendor_linked_signals_failed", err },
        "GET /api/vendors/:id/signals failed"
      );
      res.status(500).json({ error: "vendor_linked_signals_failed" });
    }
  }
);

/* =========================================================
   GET /api/cyber-signals/:id/vendors
   List vendors linked to a cyber signal in this organization.
   ========================================================= */

router.get(
  "/cyber-signals/:id/vendors",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req: Request, res: Response) => {
    const organizationId = getOrgId(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const signalId = String(req.params.id ?? "").trim();
    if (!isUuid(signalId)) {
      res.status(400).json({ error: "signal_id_must_be_uuid" });
      return;
    }

    try {
      const signalCheck = await pg.query(
        `SELECT 1 FROM cyber_signals
          WHERE id = $1
            AND (organization_id = $2 OR organization_id IS NULL)
          LIMIT 1`,
        [signalId, organizationId]
      );
      if ((signalCheck.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "cyber_signal_not_found" });
        return;
      }

      const limit = parseLimit(req.query.limit);

      const result = await pg.query(
        `SELECT
           svl.id           AS link_id,
           svl.note         AS link_note,
           svl.created_at   AS link_created_at,
           ${VENDOR_SELECT.split(",").map((c) => `v.${c.trim()}`).join(",\n           ")}
           FROM signal_vendor_links svl
           JOIN vendors v ON v.id = svl.vendor_id
          WHERE svl.organization_id = $1
            AND svl.signal_id = $2
            AND svl.deleted_at IS NULL
            AND v.organization_id = $1
          ORDER BY svl.created_at DESC, svl.id DESC
          LIMIT $3`,
        [organizationId, signalId, limit]
      );

      res.status(200).json({
        count: result.rows.length,
        limit,
        organizationId,
        signalId,
        vendors: result.rows
      });
    } catch (err) {
      logger.error(
        { event: "signal_linked_vendors_failed", err },
        "GET /api/cyber-signals/:id/vendors failed"
      );
      res.status(500).json({ error: "signal_linked_vendors_failed" });
    }
  }
);

export default router;
