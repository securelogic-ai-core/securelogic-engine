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
import { pg, registerAfterCommit } from "../infra/postgres.js";
import { asTenant } from "../middleware/asTenant.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { scopeFromRequest } from "../lib/seatScope.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";

const router = Router();

// ─── Shared middleware ────────────────────────────────────────────────────────

const keyMiddleware = [requireApiKey, attachOrganizationContext];

// ─── Types ───────────────────────────────────────────────────────────────────

interface ApiKeyRow {
  id: string;
  organization_id: string;
  label: string;
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
  asTenant(async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    if (!orgId) { res.status(401).json({ error: "unauthorized" }); return; }

    try {
      const result = await pg.query<ApiKeyRow>(
        `SELECT k.id, k.organization_id, k.label,
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
));

// ─── POST /api/customer/keys ──────────────────────────────────────────────────

router.post(
  "/customer/keys",
  ...keyMiddleware,
  asTenant(async (req: Request, res: Response) => {
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
      // Entitlement is a property of the organization, not the api_key.
      // New keys do not stamp entitlement_level; the column remains nullable
      // for new rows and is populated on legacy rows only.
      const rawKey  = generateApiKey();
      const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");

      // Bind the key to the ISSUER's resolved seat + role, so the key acts as
      // that identity when the seat model is on (closing the API-key admin
      // bypass). An admin's key is admin-level; a scoped user's key is scoped.
      const issuer = scopeFromRequest(req as unknown as Parameters<typeof scopeFromRequest>[0]);
      const inserted = await pg.query<ApiKeyRow>(
        `INSERT INTO api_keys
           (organization_id, label, key_hash, status, created_by_user_id, expires_at, bound_seat_type, bound_role)
         VALUES ($1, $2, $3, 'active', $4, $5, $6, $7)
         RETURNING id, organization_id, label, status,
                   last_used_at, created_at, revoked_at, expires_at, created_by_user_id`,
        [orgId, rawLabel, keyHash, userId, expiresAt, issuer.seatType, issuer.effectiveRole]
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
));

// ─── GET /api/customer/keys/usage ────────────────────────────────────────────
// Must be defined BEFORE /:keyId to avoid route collision.

router.get(
  "/customer/keys/usage",
  ...keyMiddleware,
  asTenant(async (req: Request, res: Response) => {
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
             AND u.date >= CURRENT_DATE - $2::int
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
));

// ─── DELETE /api/customer/keys/:keyId ────────────────────────────────────────

router.delete(
  "/customer/keys/:keyId",
  ...keyMiddleware,
  asTenant(async (req: Request, res: Response) => {
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
      // Ownership, current state, and the last-active-key count — read ONCE,
      // UNDER LOCK. This route is asTenant-wrapped, so everything below is
      // already one transaction that answers only after COMMIT; what was
      // missing is serialization between concurrent revocations.
      //
      // The lock covers the org's ACTIVE keys as well as the target, because
      // this handler asserts TWO things and both were racy:
      //
      //   1. this key is active  — two revocations of the SAME key both read
      //      `active`, one commits, the other's guarded UPDATE matched zero
      //      rows, and the caller was still told `{ok: true}` with a second
      //      `api_key.revoked` audit event. An operator would believe a
      //      credential was dead on the strength of a response that had
      //      changed nothing.
      //
      //   2. this is not the last active key — two revocations of DIFFERENT
      //      keys both read a count of 2, both passed, and both committed,
      //      leaving the organisation with ZERO active keys and locked out of
      //      its own API. Locking only the target row would leave that open,
      //      because the two transactions touch different rows and never
      //      contend.
      //
      // ORDER BY id makes the lock acquisition order deterministic, so two
      // concurrent revocations in the same org queue rather than deadlock.
      const locked = await pg.query<{ id: string; label: string; status: string }>(
        `SELECT id, label, status FROM api_keys
          WHERE organization_id = $2 AND (status = 'active' OR id = $1)
          ORDER BY id
          FOR UPDATE`,
        [keyId, orgId]
      );

      const target = locked.rows.find((r) => r.id === keyId);
      if (!target) {
        res.status(404).json({ error: "key_not_found" });
        return;
      }
      if (target.status !== "active") {
        res.status(409).json({ error: "key_already_revoked" });
        return;
      }

      // Counted from the LOCKED set, so it cannot move underneath the decision.
      const activeCount = locked.rows.filter((r) => r.status === "active").length;
      if (activeCount <= 1) {
        res.status(409).json({
          error: "last_active_key",
          detail: "Cannot revoke the last active API key. Create a replacement key first.",
        });
        return;
      }

      const revoked = await pg.query(
        `UPDATE api_keys
         SET status = 'revoked', revoked_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND status = 'active'`,
        [keyId, orgId]
      );
      if (revoked.rowCount !== 1) {
        // Unreachable while the lock holds — an assertion, not the mechanism.
        // Reporting success here would tell an operator a credential is dead
        // when it is still accepted at the door.
        logger.error(
          { event: "customer_key_revoke_transition_lost", orgId, keyId, rowCount: revoked.rowCount },
          "Revocation matched no row while holding FOR UPDATE"
        );
        res.status(409).json({
          error: "revoke_conflict",
          detail: "This key changed while it was being revoked. Nothing was changed — re-read it and try again.",
        });
        return;
      }

      // Deferred to AFTER COMMIT. writeAuditEvent writes on the elevated pool,
      // so calling it inline would record a revocation that a failed COMMIT
      // erased — an audit trail claiming a credential was revoked when it was
      // not is worse than no entry at all.
      registerAfterCommit(() =>
        writeAuditEvent({
          organizationId: orgId,
          actorUserId: userId,
          eventType: "api_key.revoked",
          resourceType: "api_key",
          resourceId: keyId,
          payload: { label: target.label },
        })
      );

      res.status(200).json({ ok: true });
    } catch (err) {
      logger.error({ event: "customer_key_revoke_failed", err }, "DELETE /api/customer/keys/:keyId failed");
      res.status(500).json({ error: "internal_error" });
    }
  }
));

export default router;
