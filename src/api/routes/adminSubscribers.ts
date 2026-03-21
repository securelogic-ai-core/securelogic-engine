import { Router } from "express";
import { pg } from "../infra/postgres.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function parseLimit(value: unknown): number {
  const raw = String(value ?? "").trim();

  if (!raw) return DEFAULT_LIMIT;

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(parsed, MAX_LIMIT);
}

function parseCursorPart(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw || null;
}

/* =========================================================
   LIST SUBSCRIBERS
   ========================================================= */

router.get("/subscribers", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const beforeCreatedAt = parseCursorPart(req.query.beforeCreatedAt);
    const beforeId = parseCursorPart(req.query.beforeId);

    const useCursor = Boolean(beforeCreatedAt && beforeId);

    const result = useCursor
      ? await pg.query(
          `
          SELECT
            id,
            organization_id,
            email,
            tier,
            status,
            created_at
          FROM subscribers
          WHERE (created_at, id) < ($2::timestamptz, $3::uuid)
          ORDER BY created_at DESC, id DESC
          LIMIT $1
          `,
          [limit, beforeCreatedAt, beforeId]
        )
      : await pg.query(
          `
          SELECT
            id,
            organization_id,
            email,
            tier,
            status,
            created_at
          FROM subscribers
          ORDER BY created_at DESC, id DESC
          LIMIT $1
          `,
          [limit]
        );

    const subscribers = result.rows;
    const last = subscribers.length > 0 ? subscribers[subscribers.length - 1] : null;

    res.status(200).json({
      count: subscribers.length,
      limit,
      beforeCreatedAt: useCursor ? beforeCreatedAt : null,
      beforeId: useCursor ? beforeId : null,
      nextCursor: last
        ? {
            created_at: last.created_at,
            id: last.id
          }
        : null,
      subscribers
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "admin_subscribers_query_failed" });
  }
});

/* =========================================================
   CREATE OR UPSERT SUBSCRIBER
   ========================================================= */

router.post("/subscribers", async (req, res) => {
  try {
    const organizationId = String(req.body?.organizationId ?? "").trim();
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const tier = String(req.body?.tier ?? "free").trim().toLowerCase();
    const status = String(req.body?.status ?? "active").trim().toLowerCase();

    if (!organizationId) {
      res.status(400).json({ error: "organization_id_required" });
      return;
    }

    if (!email) {
      res.status(400).json({ error: "email_required" });
      return;
    }

    const validTiers = new Set(["free", "standard", "premium"]);
    const validStatuses = new Set(["active", "inactive", "unsubscribed"]);

    if (!validTiers.has(tier)) {
      res.status(400).json({ error: "invalid_tier" });
      return;
    }

    if (!validStatuses.has(status)) {
      res.status(400).json({ error: "invalid_status" });
      return;
    }

    const result = await pg.query(
      `
      INSERT INTO subscribers (
        organization_id,
        email,
        tier,
        status,
        created_at
      )
      VALUES ($1,$2,$3,$4,NOW())
      ON CONFLICT (organization_id, email)
      DO UPDATE SET
        tier = EXCLUDED.tier,
        status = EXCLUDED.status
      RETURNING id, organization_id, email, tier, status, created_at
      `,
      [organizationId, email, tier, status]
    );

    res.status(200).json({
      ok: true,
      subscriber: result.rows[0] ?? null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "admin_subscriber_create_failed" });
  }
});

/* =========================================================
   UPDATE SUBSCRIBER
   ========================================================= */

router.patch("/subscribers/:id", async (req, res) => {
  try {
    const id = String(req.params.id ?? "").trim();

    if (!id) {
      res.status(400).json({ error: "subscriber_id_required" });
      return;
    }

    const tier = req.body?.tier;
    const status = req.body?.status;

    const validTiers = new Set(["free", "standard", "premium"]);
    const validStatuses = new Set(["active", "inactive", "unsubscribed"]);

    if (tier && !validTiers.has(tier)) {
      res.status(400).json({ error: "invalid_tier" });
      return;
    }

    if (status && !validStatuses.has(status)) {
      res.status(400).json({ error: "invalid_status" });
      return;
    }

    const result = await pg.query(
      `
      UPDATE subscribers
      SET
        tier = COALESCE($2, tier),
        status = COALESCE($3, status)
      WHERE id = $1
      RETURNING id, organization_id, email, tier, status, created_at
      `,
      [id, tier ?? null, status ?? null]
    );

    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "subscriber_not_found" });
      return;
    }

    res.status(200).json({
      ok: true,
      subscriber: result.rows[0] ?? null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "admin_subscriber_update_failed" });
  }
});

/* =========================================================
   DELETE SUBSCRIBER
   ========================================================= */

router.delete("/subscribers/:id", async (req, res) => {
  try {
    const id = String(req.params.id ?? "").trim();

    if (!id) {
      res.status(400).json({ error: "subscriber_id_required" });
      return;
    }

    const result = await pg.query(
      `
      DELETE FROM subscribers
      WHERE id = $1
      RETURNING id, organization_id, email
      `,
      [id]
    );

    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "subscriber_not_found" });
      return;
    }

    res.status(200).json({
      ok: true,
      deleted: result.rows[0] ?? null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "admin_subscriber_delete_failed" });
  }
});

export default router;
