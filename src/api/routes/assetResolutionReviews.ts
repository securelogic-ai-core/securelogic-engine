/**
 * assetResolutionReviews.ts — the PLAT-ASSET-1 human review queue surface.
 *
 *   GET  /api/asset-resolution-reviews            list (default: pending)
 *   POST /api/asset-resolution-reviews/:id/accept attach to a chosen asset
 *   POST /api/asset-resolution-reviews/:id/dismiss
 *
 * The queue holds exactly the questions machines refused to answer
 * (20261047): an identifier matching several assets, or a claimed-strong
 * identity that fails grammar validation. ACCEPT = the human names the asset
 * the identifier means — the alias is asserted in asset_identifiers (source =
 * the reporting source, a no-op if that asset already claims it); nothing is
 * retroactively attached, because rewriting a completed run's occurrences
 * would fabricate history. DISMISS = "not a real question"; a later import
 * may legitimately re-ask (the pending partial unique excludes terminal
 * rows).
 *
 * HONESTY ON AMBIGUOUS ACCEPTS: accepting does NOT withdraw the OTHER
 * assets' claims on the same identifier — destroying another source's
 * evidence is not this route's to do, and an org genuinely holding two
 * `web01`s is the exact case 20261033 protects. So after an ambiguous
 * accept, future imports may STILL resolve ambiguous until the competing
 * alias is deliberately withdrawn. The response says so
 * (competing_claims_remain), rather than letting "accepted" imply a
 * determinism it did not buy.
 *
 * Deliberately NOT here (v1 scope, recorded in the package doc): a
 * create-asset arm. Creation is a first-class existing surface
 * (POST /api/assets); accept-after-create attaches to it. One creation path,
 * not two.
 *
 * Terminal rows are immutable — accept/dismiss on a decided row is 409, the
 * signal_match_suggestions precedent. The chosen asset is re-verified against
 * the caller's org in the same tenant tx (candidate_asset_ids carries no FK).
 *
 * DARK behind SECURELOGIC_ASSET_AUTO_CREATE_ENABLED (404 when off): the queue
 * only ever gains rows from the auto-creation lane, so the surface ships and
 * wakes with it. Entitlement: premium, matching the scan-import lane that
 * feeds it (§9 rank 4).
 */

import { Router, type Request, type Response } from "express";

import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { asTenant } from "../middleware/asTenant.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { assetAutoCreateFeatureFlag } from "../lib/assetAutoCreateFlag.js";

const router = Router();

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
const MAX_DISMISSAL_REASON = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_WHERE: Record<string, string> = {
  pending: "accepted_at IS NULL AND dismissed_at IS NULL",
  accepted: "accepted_at IS NOT NULL",
  dismissed: "dismissed_at IS NOT NULL",
  all: "TRUE"
};

function orgOf(req: Request): string | null {
  return (
    (req as { organizationContext?: { organizationId?: string } }).organizationContext
      ?.organizationId ?? null
  );
}

router.get(
  "/asset-resolution-reviews",
  assetAutoCreateFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(async (req: Request, res: Response) => {
    const organizationId = orgOf(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }
    const status = typeof req.query["status"] === "string" ? req.query["status"] : "pending";
    const where = STATUS_WHERE[status];
    if (where == null) {
      res.status(400).json({
        error: "invalid_status",
        detail: `status must be one of: ${Object.keys(STATUS_WHERE).join(", ")}`
      });
      return;
    }
    const limit = Math.min(
      Math.max(Number.parseInt(String(req.query["limit"] ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );
    const offset = Math.max(Number.parseInt(String(req.query["offset"] ?? 0), 10) || 0, 0);

    try {
      const rows = await pg.query(
        `SELECT id, kind, scheme, value, source_key, scan_run_id,
                candidate_asset_ids, claims_echo, created_at,
                accepted_at, accepted_by_user_id, accepted_asset_id,
                dismissed_at, dismissed_by_user_id, dismissal_reason
           FROM asset_resolution_reviews
          WHERE organization_id = $1 AND ${where}
          ORDER BY created_at DESC, id DESC
          LIMIT $2 OFFSET $3`,
        [organizationId, limit, offset]
      );
      const count = await pg.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM asset_resolution_reviews
          WHERE organization_id = $1 AND ${where}`,
        [organizationId]
      );
      res.json({
        reviews: rows.rows,
        total: Number(count.rows[0]!.n),
        limit,
        offset
      });
    } catch (err) {
      logger.error({ err }, "asset-resolution-reviews list failed");
      res.status(500).json({ error: "internal_error" });
    }
  })
);

/** Load one PENDING review for decision, refusing terminal rows with 409. */
async function loadPending(
  organizationId: string,
  id: string,
  res: Response
): Promise<{
  id: string;
  kind: string;
  scheme: string;
  value: string;
  source_key: string;
} | null> {
  const rows = await pg.query<{
    id: string;
    kind: string;
    scheme: string;
    value: string;
    source_key: string;
    accepted_at: string | null;
    dismissed_at: string | null;
  }>(
    `SELECT id, kind, scheme, value, source_key, accepted_at, dismissed_at
       FROM asset_resolution_reviews
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, id]
  );
  const row = rows.rows[0];
  if (row == null) {
    res.status(404).json({ error: "not_found" });
    return null;
  }
  if (row.accepted_at != null || row.dismissed_at != null) {
    res.status(409).json({
      error: "review_already_decided",
      state: row.accepted_at != null ? "accepted" : "dismissed"
    });
    return null;
  }
  return row;
}

router.post(
  "/asset-resolution-reviews/:id/accept",
  assetAutoCreateFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(async (req: Request, res: Response) => {
    const organizationId = orgOf(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }
    const idRaw = req.params["id"];
    const id = typeof idRaw === "string" ? idRaw : "";
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "invalid_review_id" });
      return;
    }
    const assetId = (req.body as Record<string, unknown> | null)?.["asset_id"];
    if (typeof assetId !== "string" || !UUID_RE.test(assetId)) {
      res.status(400).json({ error: "asset_id_required", detail: "asset_id must be a UUID" });
      return;
    }

    try {
      const review = await loadPending(organizationId, id, res);
      if (review == null) return;

      // The chosen asset MUST belong to the caller's org — candidate ids
      // carry no FK, and a cross-tenant id must 404, never link.
      const asset = await pg.query<{ id: string }>(
        `SELECT id FROM assets WHERE organization_id = $1 AND id = $2`,
        [organizationId, assetId]
      );
      if ((asset.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "asset_not_found" });
        return;
      }

      // The human's answer becomes a deterministic fact for every future
      // import: the alias is asserted under the reporting source.
      await pg.query(
        `INSERT INTO asset_identifiers (organization_id, asset_id, scheme, value, source)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (organization_id, asset_id, scheme, value) DO NOTHING`,
        [organizationId, assetId, review.scheme, review.value, review.source_key]
      );

      const updated = await pg.query(
        `UPDATE asset_resolution_reviews
            SET accepted_at = NOW(), accepted_by_user_id = $3,
                accepted_asset_id = $4, updated_at = NOW()
          WHERE organization_id = $1 AND id = $2
            AND accepted_at IS NULL AND dismissed_at IS NULL
          RETURNING id`,
        [organizationId, id, req.userId ?? null, assetId]
      );
      if ((updated.rowCount ?? 0) === 0) {
        // Raced another decision inside the window — the terminal row wins.
        res.status(409).json({ error: "review_already_decided" });
        return;
      }

      const competing = await pg.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM asset_identifiers
          WHERE organization_id = $1 AND scheme = $2 AND value = $3 AND asset_id <> $4`,
        [organizationId, review.scheme, review.value, assetId]
      );
      const competingClaimsRemain = Number(competing.rows[0]!.n) > 0;

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as { apiKey?: { id?: string } }).apiKey?.id ?? null,
        actorUserId: req.userId ?? null,
        eventType: "asset_resolution_review.accepted",
        resourceType: "asset_resolution_review",
        resourceId: id,
        payload: {
          kind: review.kind,
          scheme: review.scheme,
          value: review.value,
          source_key: review.source_key,
          asset_id: assetId,
          competing_claims_remain: competingClaimsRemain
        },
        ipAddress: req.ip ?? null
      });
      res.json({
        accepted: true,
        review_id: id,
        asset_id: assetId,
        competing_claims_remain: competingClaimsRemain
      });
    } catch (err) {
      logger.error({ err }, "asset-resolution-review accept failed");
      res.status(500).json({ error: "internal_error" });
    }
  })
);

router.post(
  "/asset-resolution-reviews/:id/dismiss",
  assetAutoCreateFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(async (req: Request, res: Response) => {
    const organizationId = orgOf(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }
    const idRaw = req.params["id"];
    const id = typeof idRaw === "string" ? idRaw : "";
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "invalid_review_id" });
      return;
    }
    const reasonRaw = (req.body as Record<string, unknown> | null)?.["reason"];
    const reason =
      typeof reasonRaw === "string" && reasonRaw.trim().length > 0
        ? reasonRaw.trim().slice(0, MAX_DISMISSAL_REASON)
        : null;

    try {
      const review = await loadPending(organizationId, id, res);
      if (review == null) return;

      const updated = await pg.query(
        `UPDATE asset_resolution_reviews
            SET dismissed_at = NOW(), dismissed_by_user_id = $3,
                dismissal_reason = $4, updated_at = NOW()
          WHERE organization_id = $1 AND id = $2
            AND accepted_at IS NULL AND dismissed_at IS NULL
          RETURNING id`,
        [organizationId, id, req.userId ?? null, reason]
      );
      if ((updated.rowCount ?? 0) === 0) {
        res.status(409).json({ error: "review_already_decided" });
        return;
      }

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as { apiKey?: { id?: string } }).apiKey?.id ?? null,
        actorUserId: req.userId ?? null,
        eventType: "asset_resolution_review.dismissed",
        resourceType: "asset_resolution_review",
        resourceId: id,
        payload: {
          kind: review.kind,
          scheme: review.scheme,
          value: review.value,
          source_key: review.source_key,
          reason
        },
        ipAddress: req.ip ?? null
      });
      res.json({ dismissed: true, review_id: id });
    } catch (err) {
      logger.error({ err }, "asset-resolution-review dismiss failed");
      res.status(500).json({ error: "internal_error" });
    }
  })
);

export default router;
