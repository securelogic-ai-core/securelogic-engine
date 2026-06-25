# Example: Customer-data REST route

Mirrors `src/api/routes/actions.ts` (the cleanest reference). Shows the non-negotiables:
the middleware chain, the org early-return, org-scoped SQL, hand-written validation, audit
logging, shaped errors, and keyset pagination. Read `api-guidelines.md` alongside this.

```ts
// src/api/routes/widgets.ts
import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { validateWidgetCreate } from "../lib/widgetValidation.js";
import { writeAuditEvent } from "../lib/auditLog.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const VALID_STATUSES = new Set(["open", "in_progress", "closed"]);

function parseLimit(value: unknown): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/* POST /api/widgets — create */
router.post(
  "/widgets",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),          // tier per TENANT_ISOLATION_STANDARD §9
  async (req, res) => {
    try {
      const organizationId =
        (req as any).organizationContext?.organizationId ?? null;
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const validated = validateWidgetCreate(req.body);
      if ("error" in validated) { res.status(400).json(validated); return; }
      const { input } = validated;

      // org_id ALWAYS from context, NEVER from the body
      const result = await pg.query(
        `INSERT INTO widgets (organization_id, title, status)
         VALUES ($1, $2, 'open')
         RETURNING id, organization_id, title, status, created_at, updated_at`,
        [organizationId, input.title]
      );

      writeAuditEvent({
        organizationId,
        actorApiKeyId: (req as any).apiKey?.id ?? null,
        actorUserId:   (req as any).userId ?? null,
        eventType:     "widget.created",
        resourceType:  "widget",
        resourceId:    result.rows[0].id,
        payload:       { status: "open" },
        ipAddress:     req.ip ?? null,
      });

      res.status(201).json({ widget: result.rows[0] });
    } catch (err) {
      logger.error({ event: "widget_create_failed", err }, "POST /api/widgets failed");
      res.status(500).json({ error: "widget_create_failed" });
    }
  }
);

/* GET /api/widgets — keyset-paginated list, org-scoped */
router.get(
  "/widgets",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  async (req, res) => {
    try {
      const organizationId =
        (req as any).organizationContext?.organizationId ?? null;
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const limit = parseLimit(req.query.limit);
      const conditions: string[] = ["organization_id = $1"];
      const params: unknown[] = [organizationId];

      const status = isNonEmptyString(req.query.status) ? req.query.status : null;
      if (status !== null) {
        if (!VALID_STATUSES.has(status)) {
          res.status(400).json({ error: "invalid_status_filter", allowed: [...VALID_STATUSES] });
          return;
        }
        params.push(status);
        conditions.push(`status = $${params.length}`);
      }

      const beforeTs = isNonEmptyString(req.query.before_created_at) ? req.query.before_created_at : null;
      const beforeId = isNonEmptyString(req.query.before_id) ? req.query.before_id : null;
      if (beforeTs && beforeId) {
        params.push(beforeTs, beforeId);
        const ci = params.length - 1;
        conditions.push(`(created_at, id) < ($${ci}::timestamptz, $${ci + 1}::uuid)`);
      }

      params.push(limit);
      const result = await pg.query(
        `SELECT id, organization_id, title, status, created_at, updated_at
           FROM widgets
          WHERE ${conditions.join(" AND ")}
          ORDER BY created_at DESC, id DESC
          LIMIT $${params.length}`,
        params
      );

      const rows = result.rows;
      const last = rows.length ? rows[rows.length - 1] : null;
      res.status(200).json({
        count: rows.length,
        limit,
        organizationId,
        nextCursor: last ? { created_at: last.created_at, id: last.id } : null,
        widgets: rows,
      });
    } catch (err) {
      logger.error({ event: "widgets_list_failed", err }, "GET /api/widgets failed");
      res.status(500).json({ error: "widgets_list_failed" });
    }
  }
);

/* GET /api/widgets/:id — 404 (not 403) on cross-org miss */
router.get(
  "/widgets/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  async (req, res) => {
    try {
      const organizationId =
        (req as any).organizationContext?.organizationId ?? null;
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }
      const id = String(req.params.id ?? "").trim();
      if (!id) { res.status(400).json({ error: "widget_id_required" }); return; }

      const result = await pg.query(
        `SELECT id, organization_id, title, status, created_at, updated_at
           FROM widgets WHERE id = $1 AND organization_id = $2`,
        [id, organizationId]                    // org predicate mandatory even with a UUID id
      );
      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "widget_not_found" });   // don't reveal cross-org existence
        return;
      }
      res.status(200).json({ widget: result.rows[0] });
    } catch (err) {
      logger.error({ event: "widget_get_failed", err }, "GET /api/widgets/:id failed");
      res.status(500).json({ error: "widget_get_failed" });
    }
  }
);

export default router;
```

Then mount it in `src/api/routes/index.ts` in the `/api` platform block, next to its peers:

```ts
import widgets from "./widgets.js";
// ...
router.use("/api", widgets);
```

**Cross-row reference?** Before persisting a `vendor_id`/`control_id`/etc., pre-flight the
same-org check:

```ts
const ref = await pg.query(
  `SELECT 1 FROM vendors WHERE id = $1 AND organization_id = $2`,
  [input.vendor_id, organizationId]
);
if ((ref.rowCount ?? 0) === 0) {
  res.status(400).json({ error: "vendor_not_found_in_org" });
  return;
}
```

**Need a multi-write atomic transaction?** Wrap the handler with `asTenant(...)` (see
`api-guidelines.md` §11) and respect its constraints (no streaming, no un-awaited
`pg.query`, no concurrent queries on the tenant client, no raw `BEGIN`). Add a
`widgetsTenantWrap.test.ts`.
