import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";

const router = Router();

const VALID_PLANS = new Set(["starter", "standard", "premium"]);
const VALID_STATUSES = new Set(["active", "suspended"]);
const VALID_SCALES = new Set(["Small", "Medium", "Enterprise"]);

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function parseLimit(value: unknown): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function normalizeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
}

/* =========================================================
   LIST ORGANIZATIONS
   GET /admin/organizations?status=&limit=&before_created_at=&before_id=
   ========================================================= */

router.get("/organizations", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const statusFilter = String(req.query.status ?? "").trim().toLowerCase() || null;
    const beforeCreatedAt = String(req.query.before_created_at ?? "").trim() || null;
    const beforeId = String(req.query.before_id ?? "").trim() || null;

    const useCursor = Boolean(beforeCreatedAt && beforeId);
    const params: unknown[] = [limit];
    const conditions: string[] = [];

    if (statusFilter) {
      if (!VALID_STATUSES.has(statusFilter)) {
        res.status(400).json({ error: "invalid_status", allowed: ["active", "suspended"] });
        return;
      }
      params.push(statusFilter);
      conditions.push(`status = $${params.length}`);
    }

    if (useCursor) {
      params.push(beforeCreatedAt, beforeId);
      const ci = params.length - 1;
      conditions.push(`(created_at, id) < ($${ci}::timestamptz, $${ci + 1}::uuid)`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await pg.query(
      `
      SELECT id, name, slug, plan, status,
             regulated, handles_pii, safety_critical, scale,
             created_at, updated_at
      FROM organizations
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT $1
      `,
      params
    );

    const orgs = result.rows;
    const last = orgs.length > 0 ? orgs[orgs.length - 1] : null;

    res.status(200).json({
      count: orgs.length,
      limit,
      nextCursor: last ? { created_at: last.created_at, id: last.id } : null,
      organizations: orgs
    });
  } catch (err) {
    logger.error({ event: "admin_orgs_list_failed", err }, "GET /admin/organizations failed");
    res.status(500).json({ error: "admin_orgs_list_failed" });
  }
});

/* =========================================================
   GET SINGLE ORGANIZATION
   GET /admin/organizations/:id
   ========================================================= */

router.get("/organizations/:id", async (req, res) => {
  try {
    const id = String(req.params.id ?? "").trim();

    if (!id) {
      res.status(400).json({ error: "organization_id_required" });
      return;
    }

    const result = await pg.query(
      `SELECT id, name, slug, plan, status,
              regulated, handles_pii, safety_critical, scale,
              created_at, updated_at
       FROM organizations WHERE id = $1`,
      [id]
    );

    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "organization_not_found" });
      return;
    }

    res.status(200).json({ organization: result.rows[0] });
  } catch (err) {
    logger.error({ event: "admin_org_get_failed", err }, "GET /admin/organizations/:id failed");
    res.status(500).json({ error: "admin_org_get_failed" });
  }
});

/* =========================================================
   CREATE ORGANIZATION
   POST /admin/organizations
   Body: { name, slug?, plan? }

   slug defaults to a normalized version of name if omitted.
   plan defaults to 'starter'.
   ========================================================= */

router.post("/organizations", async (req, res) => {
  try {
    const name = String(req.body?.name ?? "").trim();
    const rawSlug = String(req.body?.slug ?? "").trim();
    const plan = String(req.body?.plan ?? "starter").trim().toLowerCase();

    if (!name) {
      res.status(400).json({ error: "name_required" });
      return;
    }

    if (!VALID_PLANS.has(plan)) {
      res.status(400).json({ error: "invalid_plan", allowed: ["starter", "standard", "premium"] });
      return;
    }

    const slug = normalizeSlug(rawSlug || name);

    if (!slug) {
      res.status(400).json({ error: "slug_invalid" });
      return;
    }

    // Org profile fields — optional on create, defaults match DB column defaults
    const regulated      = req.body?.regulated      ?? false;
    const handlesPii     = req.body?.handles_pii    ?? false;
    const safetyCritical = req.body?.safety_critical ?? false;
    const scale          = req.body?.scale          ?? "Small";

    if (typeof regulated !== "boolean") {
      res.status(400).json({ error: "invalid_regulated", expected: "boolean" });
      return;
    }
    if (typeof handlesPii !== "boolean") {
      res.status(400).json({ error: "invalid_handles_pii", expected: "boolean" });
      return;
    }
    if (typeof safetyCritical !== "boolean") {
      res.status(400).json({ error: "invalid_safety_critical", expected: "boolean" });
      return;
    }
    if (!VALID_SCALES.has(scale)) {
      res.status(400).json({ error: "invalid_scale", allowed: ["Small", "Medium", "Enterprise"] });
      return;
    }

    let result;
    try {
      result = await pg.query(
        `
        INSERT INTO organizations (
          name, slug, plan, status,
          regulated, handles_pii, safety_critical, scale,
          created_at, updated_at
        )
        VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, NOW(), NOW())
        RETURNING id, name, slug, plan, status,
                  regulated, handles_pii, safety_critical, scale,
                  created_at, updated_at
        `,
        [name, slug, plan, regulated, handlesPii, safetyCritical, scale]
      );
    } catch (err: any) {
      // Postgres unique violation on slug
      if (err?.code === "23505") {
        res.status(409).json({ error: "slug_already_exists", slug });
        return;
      }
      throw err;
    }

    const org = result.rows[0];

    logger.info(
      { event: "admin_org_created", id: org.id, slug: org.slug, plan: org.plan },
      "admin: organization created"
    );

    res.status(201).json({ ok: true, organization: org });
  } catch (err) {
    logger.error({ event: "admin_org_create_failed", err }, "POST /admin/organizations failed");
    res.status(500).json({ error: "admin_org_create_failed" });
  }
});

/* =========================================================
   UPDATE ORGANIZATION
   PATCH /admin/organizations/:id
   Body: { plan?, status? }
   ========================================================= */

router.patch("/organizations/:id", async (req, res) => {
  try {
    const id = String(req.params.id ?? "").trim();

    if (!id) {
      res.status(400).json({ error: "organization_id_required" });
      return;
    }

    const plan   = req.body?.plan   != null ? String(req.body.plan).trim().toLowerCase()   : null;
    const status = req.body?.status != null ? String(req.body.status).trim().toLowerCase() : null;
    const scale  = req.body?.scale  != null ? String(req.body.scale).trim()                : null;

    // Boolean profile fields: must be actual booleans — not strings, not numbers
    let regulated: boolean | null      = null;
    let handlesPii: boolean | null     = null;
    let safetyCritical: boolean | null = null;

    if (req.body?.regulated !== undefined) {
      if (typeof req.body.regulated !== "boolean") {
        res.status(400).json({ error: "invalid_regulated", expected: "boolean" });
        return;
      }
      regulated = req.body.regulated;
    }

    if (req.body?.handles_pii !== undefined) {
      if (typeof req.body.handles_pii !== "boolean") {
        res.status(400).json({ error: "invalid_handles_pii", expected: "boolean" });
        return;
      }
      handlesPii = req.body.handles_pii;
    }

    if (req.body?.safety_critical !== undefined) {
      if (typeof req.body.safety_critical !== "boolean") {
        res.status(400).json({ error: "invalid_safety_critical", expected: "boolean" });
        return;
      }
      safetyCritical = req.body.safety_critical;
    }

    // Monitored-entity cap (vendors + ai_systems combined). This is the
    // operator path for the sales-led "Platform Scale" raise — set a higher
    // cap per contract. Must be a non-negative integer. An admin-set cap
    // survives Stripe events (the webhook only raises to the default, never
    // lowers), so lowering a cap is exclusively this operator action.
    let maxMonitoredEntities: number | null = null;
    if (req.body?.max_monitored_entities !== undefined) {
      const v = req.body.max_monitored_entities;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        res.status(400).json({
          error: "invalid_max_monitored_entities",
          expected: "non-negative integer"
        });
        return;
      }
      maxMonitoredEntities = v;
    }

    // Seat cap (active members). The sales-led operator path for seat
    // allocation above the default 6 — Team is "up to 6 seats" (= default),
    // Platform / Enterprise ("Unlimited seats", Custom / invoice) are raised
    // here per contract. Mirrors max_monitored_entities: non-negative integer,
    // never auto-touched by Stripe (no self-serve tier exceeds 6 seats), so
    // lowering or raising it is exclusively this operator action. (#9b)
    let maxMembers: number | null = null;
    if (req.body?.max_members !== undefined) {
      const v = req.body.max_members;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        res.status(400).json({
          error: "invalid_max_members",
          expected: "non-negative integer"
        });
        return;
      }
      maxMembers = v;
    }

    if (plan !== null && !VALID_PLANS.has(plan)) {
      res.status(400).json({ error: "invalid_plan", allowed: ["starter", "standard", "premium"] });
      return;
    }

    if (status !== null && !VALID_STATUSES.has(status)) {
      res.status(400).json({ error: "invalid_status", allowed: ["active", "suspended"] });
      return;
    }

    if (scale !== null && !VALID_SCALES.has(scale)) {
      res.status(400).json({ error: "invalid_scale", allowed: ["Small", "Medium", "Enterprise"] });
      return;
    }

    const hasUpdate =
      plan !== null ||
      status !== null ||
      regulated !== null ||
      handlesPii !== null ||
      safetyCritical !== null ||
      scale !== null ||
      maxMonitoredEntities !== null ||
      maxMembers !== null;

    if (!hasUpdate) {
      res.status(400).json({ error: "no_fields_to_update" });
      return;
    }

    const result = await pg.query(
      `
      UPDATE organizations
      SET
        plan                   = COALESCE($2, plan),
        status                 = COALESCE($3, status),
        regulated              = COALESCE($4, regulated),
        handles_pii            = COALESCE($5, handles_pii),
        safety_critical        = COALESCE($6, safety_critical),
        scale                  = COALESCE($7, scale),
        max_monitored_entities = COALESCE($8, max_monitored_entities),
        max_members            = COALESCE($9, max_members),
        updated_at             = NOW()
      WHERE id = $1
      RETURNING id, name, slug, plan, status,
                regulated, handles_pii, safety_critical, scale,
                max_monitored_entities, max_members,
                created_at, updated_at
      `,
      [id, plan, status, regulated, handlesPii, safetyCritical, scale, maxMonitoredEntities, maxMembers]
    );

    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "organization_not_found" });
      return;
    }

    const org = result.rows[0];

    logger.info(
      {
        event: "admin_org_updated",
        id: org.id,
        plan: org.plan,
        status: org.status,
        regulated: org.regulated,
        handles_pii: org.handles_pii,
        safety_critical: org.safety_critical,
        scale: org.scale,
        max_monitored_entities: org.max_monitored_entities,
        max_members: org.max_members
      },
      "admin: organization updated"
    );

    res.status(200).json({ ok: true, organization: org });
  } catch (err) {
    logger.error({ event: "admin_org_update_failed", err }, "PATCH /admin/organizations/:id failed");
    res.status(500).json({ error: "admin_org_update_failed" });
  }
});

export default router;
