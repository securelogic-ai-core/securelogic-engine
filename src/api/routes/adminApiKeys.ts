import { Router } from "express";
import crypto from "crypto";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";

const router = Router();

const VALID_ENTITLEMENT_LEVELS = new Set(["starter", "standard", "premium"]);

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function parseLimit(value: unknown): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

/**
 * Generates a SecureLogic API key.
 * Format: sl_ + 32 lowercase hex chars (always valid against ^sl_[a-z0-9]{16,64}$)
 */
function generateApiKey(): string {
  return "sl_" + crypto.randomBytes(16).toString("hex");
}

/* =========================================================
   LIST API KEYS
   GET /admin/api-keys?organization_id=&limit=&before_created_at=&before_id=
   ========================================================= */

router.get("/api-keys", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const organizationId = String(req.query.organization_id ?? "").trim() || null;
    const beforeCreatedAt = String(req.query.before_created_at ?? "").trim() || null;
    const beforeId = String(req.query.before_id ?? "").trim() || null;

    const useCursor = Boolean(beforeCreatedAt && beforeId);

    const params: unknown[] = [limit];
    const conditions: string[] = [];

    if (organizationId) {
      params.push(organizationId);
      conditions.push(`organization_id = $${params.length}`);
    }

    if (useCursor) {
      params.push(beforeCreatedAt, beforeId);
      const ci = params.length - 1;
      conditions.push(`(created_at, id) < ($${ci}::timestamptz, $${ci + 1}::uuid)`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await pg.query(
      `
      SELECT
        id,
        organization_id,
        label,
        entitlement_level,
        status,
        last_used_at,
        created_at,
        revoked_at
      FROM api_keys
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT $1
      `,
      params
    );

    const keys = result.rows;
    const last = keys.length > 0 ? keys[keys.length - 1] : null;

    res.status(200).json({
      count: keys.length,
      limit,
      nextCursor: last ? { created_at: last.created_at, id: last.id } : null,
      api_keys: keys
    });
  } catch (err) {
    logger.error({ event: "admin_api_keys_list_failed", err }, "GET /admin/api-keys failed");
    res.status(500).json({ error: "admin_api_keys_list_failed" });
  }
});

/* =========================================================
   CREATE API KEY
   POST /admin/api-keys
   Body: { organization_id, label, entitlement_level }

   The raw key is returned once in the response. It is NOT
   retrievable again — store it immediately.
   ========================================================= */

router.post("/api-keys", async (req, res) => {
  try {
    const organizationId = String(req.body?.organization_id ?? "").trim();
    const label = String(req.body?.label ?? "").trim();
    const entitlementLevel = String(req.body?.entitlement_level ?? "").trim().toLowerCase();

    if (!organizationId) {
      res.status(400).json({ error: "organization_id_required" });
      return;
    }

    if (!label) {
      res.status(400).json({ error: "label_required" });
      return;
    }

    if (!VALID_ENTITLEMENT_LEVELS.has(entitlementLevel)) {
      res.status(400).json({
        error: "invalid_entitlement_level",
        allowed: ["starter", "standard", "premium"]
      });
      return;
    }

    // Verify organization exists
    const orgCheck = await pg.query(
      `SELECT id FROM organizations WHERE id = $1`,
      [organizationId]
    );

    if ((orgCheck.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "organization_not_found" });
      return;
    }

    const rawKey = generateApiKey();

    const result = await pg.query(
      `
      INSERT INTO api_keys (organization_id, label, key_hash, entitlement_level, status, created_at)
      VALUES ($1, $2, $3, $4, 'active', NOW())
      RETURNING id, organization_id, label, entitlement_level, status, created_at
      `,
      [organizationId, label, rawKey, entitlementLevel]
    );

    const row = result.rows[0];

    logger.info(
      {
        event: "admin_api_key_created",
        id: row.id,
        organization_id: organizationId,
        entitlement_level: entitlementLevel,
        keyPrefix: rawKey.slice(0, 6)
      },
      "admin: api key created"
    );

    res.status(201).json({
      ok: true,
      // Raw key returned once — not stored in hashed form, never retrievable again via API
      key: rawKey,
      api_key: row
    });
  } catch (err) {
    logger.error({ event: "admin_api_key_create_failed", err }, "POST /admin/api-keys failed");
    res.status(500).json({ error: "admin_api_key_create_failed" });
  }
});

/* =========================================================
   REVOKE API KEY
   DELETE /admin/api-keys/:id
   Soft-delete: sets status='revoked' and revoked_at=NOW()
   ========================================================= */

router.delete("/api-keys/:id", async (req, res) => {
  try {
    const id = String(req.params.id ?? "").trim();

    if (!id) {
      res.status(400).json({ error: "api_key_id_required" });
      return;
    }

    const result = await pg.query(
      `
      UPDATE api_keys
      SET status = 'revoked', revoked_at = NOW()
      WHERE id = $1 AND status != 'revoked'
      RETURNING id, organization_id, label, entitlement_level, status, revoked_at
      `,
      [id]
    );

    if ((result.rowCount ?? 0) === 0) {
      // Check if key exists at all vs already revoked
      const exists = await pg.query(`SELECT id, status FROM api_keys WHERE id = $1`, [id]);

      if ((exists.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "api_key_not_found" });
        return;
      }

      // Already revoked — idempotent success
      res.status(200).json({ ok: true, already_revoked: true });
      return;
    }

    const row = result.rows[0];

    logger.info(
      {
        event: "admin_api_key_revoked",
        id: row.id,
        organization_id: row.organization_id
      },
      "admin: api key revoked"
    );

    res.status(200).json({ ok: true, api_key: row });
  } catch (err) {
    logger.error({ event: "admin_api_key_revoke_failed", err }, "DELETE /admin/api-keys/:id failed");
    res.status(500).json({ error: "admin_api_key_revoke_failed" });
  }
});

export default router;
