/**
 * aiSystemGovernanceLinks.ts — the four AI-system governance edges (T2-B).
 *
 * The gap this closes, from the capability baseline, verbatim: "The chain the
 * program asks for — AI system → applicable policy/regulation/framework →
 * controls → evidence — cannot be represented in the current schema at all."
 * The tables live in db/migrations/20261038_ai_system_governance_links.sql;
 * these routes are the only writers.
 *
 * FOUR FAMILIES, ONE SHAPE. Each edge kind (framework / control / policy /
 * obligation) gets the identical three routes:
 *
 *   POST   /api/ai-system-<kind>-links          — declare the edge
 *   DELETE /api/ai-system-<kind>-links/:id      — retract it
 *   GET    /api/ai-systems/:id/<kind-plural>    — list a system's edges,
 *                                                 joined to the target's name
 *
 * The registration is table-driven rather than copy-pasted four times: the
 * families differ ONLY in table and target names, and four hand-maintained
 * copies of one handler is how the third copy quietly diverges from the
 * fourth. The FAMILIES table below is the entire difference surface.
 *
 * EVERY LINK IS A HUMAN DECLARATION. Nothing here is created automatically,
 * and there is no update route at all: a link is created and deleted, never
 * edited. Re-pointing a governance declaration is a delete plus a create —
 * two audit rows, which is the point. (The DB agrees: the tables carry no
 * UPDATE grant.)
 *
 * TENANCY. organization_id comes from the request context only. Both
 * endpoints of every edge are pre-flighted same-org before insert — all four
 * target tables (frameworks included) are org-scoped — and every read carries
 * the org predicate on both sides of the join. 404, not 403, for a foreign or
 * missing endpoint: a cross-org id must be indistinguishable from one that
 * does not exist.
 *
 * Guard chain and idempotency contract follow aiSystemVendorDependencies.ts,
 * the sibling this file is modeled on: premium entitlement, contributor
 * denied, asTenant-wrapped; POST of an existing edge returns it unchanged
 * with created:false (ON CONFLICT DO NOTHING against the unique constraint,
 * so the SELECT-then-INSERT race cannot create duplicates).
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

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function getOrgId(req: Request): string | null {
  return (req as any).organizationContext?.organizationId ?? null;
}

function getApiKeyId(req: Request): string | null {
  return (req as any).apiKey?.id ?? null;
}

/**
 * The entire difference surface between the four families. Everything not in
 * this table is deliberately identical.
 *
 *   kind        the URL segment and audit-event noun ("framework")
 *   plural      the list-route segment ("frameworks")
 *   table       the link table
 *   targetTable the org-scoped table the edge points at
 *   targetCol   the link table's FK column to it
 *   targetName  the target's display column, joined into list reads
 */
const FAMILIES = [
  {
    kind: "framework",
    plural: "frameworks",
    table: "ai_system_framework_links",
    targetTable: "frameworks",
    targetCol: "framework_id",
    targetName: "name"
  },
  {
    kind: "control",
    plural: "controls",
    table: "ai_system_control_links",
    targetTable: "controls",
    targetCol: "control_id",
    targetName: "name"
  },
  {
    kind: "policy",
    plural: "policies",
    table: "ai_system_policy_links",
    targetTable: "policies",
    targetCol: "policy_id",
    targetName: "name"
  },
  {
    kind: "obligation",
    plural: "obligations",
    table: "ai_system_obligation_links",
    targetTable: "obligations",
    targetCol: "obligation_id",
    targetName: "title"
  }
] as const;

type Family = (typeof FAMILIES)[number];

/* =========================================================
   Handlers, parameterised by family
   ========================================================= */

function createLink(family: Family) {
  return async (req: Request, res: Response): Promise<void> => {
    const organizationId = getOrgId(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const aiSystemId = body["ai_system_id"];
    const targetId = body[family.targetCol];
    if (!isUuid(aiSystemId)) {
      res.status(400).json({ error: "ai_system_id_must_be_uuid" });
      return;
    }
    if (!isUuid(targetId)) {
      res.status(400).json({ error: `${family.targetCol}_must_be_uuid` });
      return;
    }

    try {
      // Pre-flight both endpoints same-org. 404 not 403 (see header).
      const aiCheck = await pg.query(
        `SELECT 1 FROM ai_systems WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [aiSystemId, organizationId]
      );
      if ((aiCheck.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "ai_system_not_found" });
        return;
      }
      const targetCheck = await pg.query(
        `SELECT 1 FROM ${family.targetTable} WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [targetId, organizationId]
      );
      if ((targetCheck.rowCount ?? 0) === 0) {
        res.status(404).json({ error: `${family.kind}_not_found` });
        return;
      }

      const inserted = await pg.query(
        `INSERT INTO ${family.table}
           (organization_id, ai_system_id, ${family.targetCol}, created_by_user_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (organization_id, ai_system_id, ${family.targetCol}) DO NOTHING
         RETURNING id, organization_id, ai_system_id, ${family.targetCol}, created_by_user_id, created_at`,
        [organizationId, aiSystemId, targetId, req.userId ?? null]
      );

      if ((inserted.rowCount ?? 0) === 0) {
        // The edge already exists — return it unchanged (POST idempotency
        // contract shared with aiSystemVendorDependencies).
        const existing = await pg.query(
          `SELECT id, organization_id, ai_system_id, ${family.targetCol}, created_by_user_id, created_at
             FROM ${family.table}
            WHERE organization_id = $1 AND ai_system_id = $2 AND ${family.targetCol} = $3
            LIMIT 1`,
          [organizationId, aiSystemId, targetId]
        );
        res.status(200).json({ link: existing.rows[0], created: false });
        return;
      }

      const link = inserted.rows[0];
      writeAuditEvent({
        organizationId,
        actorApiKeyId: getApiKeyId(req),
        actorUserId: req.userId ?? null,
        eventType: `ai_system.${family.kind}_linked`,
        resourceType: "ai_system",
        resourceId: aiSystemId as string,
        payload: { link_id: link.id, [family.targetCol]: targetId },
        ipAddress: req.ip ?? null
      });

      res.status(201).json({ link, created: true });
    } catch (err) {
      logger.error(
        { event: `ai_system_${family.kind}_link_failed`, err },
        `POST /api/ai-system-${family.kind}-links failed`
      );
      res.status(500).json({ error: `ai_system_${family.kind}_link_failed` });
    }
  };
}

function deleteLink(family: Family) {
  return async (req: Request, res: Response): Promise<void> => {
    const organizationId = getOrgId(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }
    const linkId = String(req.params["id"] ?? "").trim();
    if (!isUuid(linkId)) {
      res.status(400).json({ error: "link_id_must_be_uuid" });
      return;
    }

    try {
      const deleted = await pg.query<{ ai_system_id: string; target_id: string }>(
        `DELETE FROM ${family.table}
          WHERE id = $1 AND organization_id = $2
          RETURNING ai_system_id, ${family.targetCol} AS target_id`,
        [linkId, organizationId]
      );
      if ((deleted.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "link_not_found" });
        return;
      }

      const row = deleted.rows[0]!;
      writeAuditEvent({
        organizationId,
        actorApiKeyId: getApiKeyId(req),
        actorUserId: req.userId ?? null,
        eventType: `ai_system.${family.kind}_unlinked`,
        resourceType: "ai_system",
        resourceId: row.ai_system_id,
        payload: { link_id: linkId, [family.targetCol]: row.target_id },
        ipAddress: req.ip ?? null
      });

      res.status(200).json({ deleted: true });
    } catch (err) {
      logger.error(
        { event: `ai_system_${family.kind}_unlink_failed`, err },
        `DELETE /api/ai-system-${family.kind}-links/:id failed`
      );
      res.status(500).json({ error: `ai_system_${family.kind}_unlink_failed` });
    }
  };
}

function listLinks(family: Family) {
  return async (req: Request, res: Response): Promise<void> => {
    const organizationId = getOrgId(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }
    const aiSystemId = String(req.params["id"] ?? "").trim();
    if (!isUuid(aiSystemId)) {
      res.status(400).json({ error: "ai_system_id_must_be_uuid" });
      return;
    }

    try {
      // Existence pre-flight so an empty list is "no links" and never "no
      // such system" — the two must not be conflated on a read surface.
      const aiCheck = await pg.query(
        `SELECT 1 FROM ai_systems WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [aiSystemId, organizationId]
      );
      if ((aiCheck.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "ai_system_not_found" });
        return;
      }

      // Org predicate on BOTH sides of the join — the linkage lesson.
      const result = await pg.query(
        `SELECT l.id, l.${family.targetCol}, l.created_by_user_id, l.created_at,
                t.${family.targetName} AS target_name
           FROM ${family.table} l
           JOIN ${family.targetTable} t
             ON t.id = l.${family.targetCol}
            AND t.organization_id = l.organization_id
          WHERE l.ai_system_id = $1
            AND l.organization_id = $2
          ORDER BY l.created_at DESC, l.id DESC`,
        [aiSystemId, organizationId]
      );

      res.status(200).json({ count: result.rows.length, links: result.rows });
    } catch (err) {
      logger.error(
        { event: `ai_system_${family.plural}_list_failed`, err },
        `GET /api/ai-systems/:id/${family.plural} failed`
      );
      res.status(500).json({ error: `ai_system_${family.plural}_list_failed` });
    }
  };
}

/* =========================================================
   Registration — same guard chain as aiSystemVendorDependencies
   ========================================================= */

for (const family of FAMILIES) {
  const chain = [
    requireApiKey,
    attachOrganizationContext,
    requireEntitlement("premium"),
    denyContributor()
  ] as const;

  router.post(`/ai-system-${family.kind}-links`, ...chain, asTenant(createLink(family)));
  router.delete(`/ai-system-${family.kind}-links/:id`, ...chain, asTenant(deleteLink(family)));
  router.get(`/ai-systems/:id/${family.plural}`, ...chain, asTenant(listLinks(family)));
}

export default router;
