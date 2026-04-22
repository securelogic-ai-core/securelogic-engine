/**
 * customerApiKeys.ts — Self-service API key management for platform customers.
 *
 * Routes:
 *   GET    /api/customer/keys          — List all keys for the org
 *   POST   /api/customer/keys          — Create a new key
 *   DELETE /api/customer/keys/:keyId   — Revoke a key (JWT auth required)
 *   GET    /api/customer/keys/usage    — Usage summary (30-day default)
 *
 * All routes require: requireApiKey + attachOrganizationContext.
 * No entitlement gate — all tiers get key management.
 * Key creation and revocation require JWT auth (req.userId must be set).
 */

import crypto from "crypto";
import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";

const router = Router();

// ─── Shared middleware ────────────────────────────────────────────────────────

const keyMiddleware = [requireApiKey, attachOrganizationContext];

// ─── Types ───────────────────────────────────────────────────────────────────

interface ApiKeyRow {
  id: string;
  organization_id: string;
  label: string;
  entitlement_level: string;
  status: string;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
  expires_at: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
}

function generateApiKey(): string {
  return "sl_" + crypto.randomBytes(16).toString("hex");
}

function getOrgId(req: Request): string | null {
  return (req as any).organizationContext?.organizationId ?? null;
}

// ─── GET /api/customer/keys ───────────────────────────────────────────────────

router.get(
  "/customer/keys",
  ...keyMiddleware,
  async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    if (!orgId) { res.status(401).json({ error: "unauthorized" }); return; }

    try {
      const result = await pg.query<ApiKeyRow>(
        `SELECT k.id, k.organization_id, k.label, k.entitlement_level,
                k.status, k.last_used_at, k.created_at, k.revoked_at, k.expires_at,
                k.created_by_user_id,
                (SELECT u.name FROM users u WHERE u.id = k.created_by_user_id) AS created_by_name
         FROM api_keys k
         WHERE k.organization_id = $1
         ORDER BY k.created_at DESC`,
        [orgId]
      );

      res.status(200).json({ keys: result.rows });
    } catch (err) {
      logger.error({ event: "customer_keys_list_failed", err }, "GET /api/customer/keys failed");
      res.status(500).json({ error: "internal_error" });
    }
  }
);

// ─── POST /api/customer/keys ──────────────────────────────────────────────────

router.post(
  "/customer/keys",
  ...keyMiddleware,
  async (req: Request, res: Response) => {
    const orgId  = getOrgId(req);
    const userId = (req as any).jwtPayload?.sub as string | undefined ?? null;

    if (!orgId) { res.status(401).json({ error: "unauthorized" }); return; }
    if (!userId) {
      res.status(403).json({ error: "jwt_required", detail: "Key creation requires JWT authentication." });
      return;
    }

    const rawLabel = typeof req.body?.label === "string" ? req.body.label.trim() : "";
    if (!rawLabel) { res.status(400).json({ error: "label_required" }); return; }
    if (rawLabel.length > 100) { res.status(400).json({ error: "label_too_long", max: 100 }); return; }

    let expiresAt: Date | null = null;
    if (req.body?.expires_at != null && req.body.expires_at !== "") {
      const parsed = new Date(req.body.expires_at as string);
      const twoYearsFromNow = new Date();
      twoYearsFromNow.setFullYear(twoYearsFromNow.getFullYear() + 2);
      if (isNaN(parsed.getTime()) || parsed <= new Date() || parsed > twoYearsFromNow) {
        res.status(400).json({
          error: "invalid_expires_at",
          detail: "Expiry must be a future date within 2 years."
        });
        return;
      }
      expiresAt = parsed;
    }

    try {
      // Inherit entitlement from the org's existing primary key
      const entitlementResult = await pg.query<{ entitlement_level: string }>(
        `SELECT entitlement_level FROM api_keys
         WHERE organization_id = $1 AND status = 'active'
         ORDER BY created_at ASC LIMIT 1`,
        [orgId]
      );
      const entitlementLevel = entitlementResult.rows[0]?.entitlement_level ?? "starter";

      const rawKey  = generateApiKey();
      const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");

      const inserted = await pg.query<ApiKeyRow>(
        `INSERT INTO api_keys
           (organization_id, label, key_hash, entitlement_level, status, created_by_user_id, expires_at)
         VALUES ($1, $2, $3, $4, 'active', $5, $6)
         RETURNING id, organization_id, label, entitlement_level, status,
                   last_used_at, created_at, revoked_at, expires_at, created_by_user_id`,
        [orgId, rawLabel, keyHash, entitlementLevel, userId, expiresAt]
      );

      const newKey = inserted.rows[0]!;

      writeAuditEvent({
        organizationId: orgId,
        actorUserId: userId,
        eventType: "api_key.created",
        resourceType: "api_key",
        resourceId: newKey.id,
        payload: { label: rawLabel },
      });

      res.status(201).json({
        key: { ...newKey, created_by_name: null },
        rawKey,
      });
    } catch (err) {
      logger.error({ event: "customer_key_create_failed", err }, "POST /api/customer/keys failed");
      res.status(500).json({ error: "internal_error" });
    }
  }
);

// ─── GET /api/customer/keys/usage ────────────────────────────────────────────
// Must be defined BEFORE /:keyId to avoid route collision.

router.get(
  "/customer/keys/usage",
  ...keyMiddleware,
  async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    if (!orgId) { res.status(401).json({ error: "unauthorized" }); return; }

    const rawDays = Number(String(req.query.days ?? "30").trim());
    const periodDays = [7, 30, 90].includes(rawDays) ? rawDays : 30;

    try {
      const [keySummary, dailyBreakdown] = await Promise.all([
        pg.query<{
          key_id: string;
          label: string;
          status: string;
          total_requests: string;
          requests_last_7_days: string;
          last_active_date: string | null;
        }>(
          `SELECT
             k.id AS key_id,
             k.label,
             k.status,
             COALESCE(SUM(u.request_count), 0)::bigint AS total_requests,
             COALESCE(SUM(
               CASE WHEN u.date >= CURRENT_DATE - 6 THEN u.request_count ELSE 0 END
             ), 0)::bigint AS requests_last_7_days,
             MAX(u.date)::text AS last_active_date
           FROM api_keys k
           LEFT JOIN api_usage_daily u
             ON u.api_key_id = k.id
             AND u.date >= CURRENT_DATE - $2
           WHERE k.organization_id = $1
           GROUP BY k.id, k.label, k.status
           ORDER BY total_requests DESC`,
          [orgId, periodDays]
        ),
        pg.query<{ date: string; total: string }>(
          `SELECT date::text, SUM(request_count)::bigint AS total
           FROM api_usage_daily
           WHERE organization_id = $1
             AND date >= CURRENT_DATE - 29
           GROUP BY date
           ORDER BY date ASC`,
          [orgId]
        ),
      ]);

      const keys = keySummary.rows.map((r) => ({
        key_id: r.key_id,
        label: r.label,
        status: r.status,
        total_requests: Number(r.total_requests),
        requests_last_7_days: Number(r.requests_last_7_days),
        last_active_date: r.last_active_date,
      }));

      const daily = dailyBreakdown.rows.map((r) => ({
        date: r.date,
        total: Number(r.total),
      }));

      const totalRequests = keys.reduce((s, k) => s + k.total_requests, 0);

      res.status(200).json({ keys, daily, totalRequests, periodDays });
    } catch (err) {
      logger.error({ event: "customer_key_usage_failed", err }, "GET /api/customer/keys/usage failed");
      res.status(500).json({ error: "internal_error" });
    }
  }
);

// ─── DELETE /api/customer/keys/:keyId ────────────────────────────────────────

router.delete(
  "/customer/keys/:keyId",
  ...keyMiddleware,
  async (req: Request, res: Response) => {
    const orgId  = getOrgId(req);
    const userId = (req as any).jwtPayload?.sub as string | undefined ?? null;
    const keyId  = typeof req.params.keyId === "string" ? req.params.keyId : String(req.params.keyId ?? "");

    if (!orgId) { res.status(401).json({ error: "unauthorized" }); return; }
    if (!userId) {
      res.status(403).json({ error: "jwt_required", detail: "Key revocation requires JWT authentication." });
      return;
    }
    if (!keyId) { res.status(400).json({ error: "key_id_required" }); return; }

    try {
      // Load the key first to verify ownership and get label for audit
      const keyCheck = await pg.query<{ id: string; label: string; status: string }>(
        `SELECT id, label, status FROM api_keys
         WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [keyId, orgId]
      );

      if (keyCheck.rows.length === 0) {
        res.status(404).json({ error: "key_not_found" });
        return;
      }

      const target = keyCheck.rows[0]!;
      if (target.status !== "active") {
        res.status(409).json({ error: "key_already_revoked" });
        return;
      }

      // Prevent revoking the last active key
      const activeCount = await pg.query<{ count: string }>(
        `SELECT COUNT(*)::bigint AS count FROM api_keys
         WHERE organization_id = $1 AND status = 'active'`,
        [orgId]
      );
      if (Number(activeCount.rows[0]?.count ?? 0) <= 1) {
        res.status(409).json({
          error: "last_active_key",
          detail: "Cannot revoke the last active API key. Create a replacement key first.",
        });
        return;
      }

      await pg.query(
        `UPDATE api_keys
         SET status = 'revoked', revoked_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND status = 'active'`,
        [keyId, orgId]
      );

      writeAuditEvent({
        organizationId: orgId,
        actorUserId: userId,
        eventType: "api_key.revoked",
        resourceType: "api_key",
        resourceId: keyId,
        payload: { label: target.label },
      });

      res.status(200).json({ ok: true });
    } catch (err) {
      logger.error({ event: "customer_key_revoke_failed", err }, "DELETE /api/customer/keys/:keyId failed");
      res.status(500).json({ error: "internal_error" });
    }
  }
);

export default router;
