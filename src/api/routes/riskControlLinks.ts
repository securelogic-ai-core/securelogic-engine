/**
 * riskControlLinks.ts — Tenant-scoped linkage between risks and controls (RR-4).
 *
 * Mirrors the hardened template established by signal_*_links (May 2026 link-
 * table standard) with one deliberate enhancement: re-linking a previously
 * soft-deleted (risk, control) pair undeletes the existing row in place
 * rather than inserting a new row alongside the orphan. Result: at most one
 * row per (org, risk, control) ever exists in the table.
 *
 * ROUTES (nested under risks / controls; the URL carries the parent IDs)
 *   POST   /api/risks/:id/controls
 *            Body: { control_id: UUID, note?: string<=500 }
 *            Idempotent — see "RE-LINK SEMANTICS" below.
 *   DELETE /api/risks/:id/controls/:controlId
 *            Soft-delete. 404 on already-deleted or never-existed.
 *   GET    /api/risks/:id/controls
 *            Forward direction — controls mitigating this risk.
 *   GET    /api/controls/:id/risks
 *            Inverse direction — risks mitigated by this control.
 *
 * RE-LINK SEMANTICS
 *   1. Live row already exists for (org, risk, control)
 *        → 200, return existing row, NO audit event (no-op).
 *   2. Soft-deleted row exists (deleted_at IS NOT NULL)
 *        → UPDATE deleted_at = NULL, refresh note, created_by_user_id,
 *          created_at; emit risk_control_link.created.
 *   3. No row exists
 *        → INSERT; emit risk_control_link.created.
 *
 *   Audit fires only on transitions into the live state (cases 2 + 3).
 *
 * TENANT RULES (TENANT_ISOLATION_STANDARD.md §1, §4, §8)
 *   - organization_id is sourced from req.organizationContext, never from
 *     the request body or any user-supplied parameter.
 *   - risk and control must both belong to the requesting org. Cross-org
 *     returns 404 (not 403) to avoid enumeration.
 *   - Audit-log every create / soft-delete via writeAuditEvent. Same shape
 *     as signal_control_links: payload is { risk_id, control_id [, note] }.
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  validateRiskControlLinkCreate,
  isUuid
} from "../lib/riskControlLinkValidation.js";

const router = Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const INTEGER_RE = /^-?\d+$/;

const LINK_SELECT = `
  id,
  organization_id,
  risk_id,
  control_id,
  note,
  created_by_user_id,
  created_at,
  deleted_at
`;

function parseLimit(value: unknown): number | null {
  if (value === undefined || value === null) return DEFAULT_LIMIT;
  const raw = String(value).trim();
  if (raw === "") return DEFAULT_LIMIT;
  if (!INTEGER_RE.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function getOrgId(req: Request): string | null {
  const ctx = (req as unknown as {
    organizationContext?: { organizationId?: string };
  }).organizationContext;
  return ctx?.organizationId ?? null;
}

function getApiKeyId(req: Request): string | null {
  return (req as unknown as { apiKey?: { id?: string } }).apiKey?.id ?? null;
}

/* =========================================================
   POST /api/risks/:id/controls
   Link a risk to a control (idempotent).
   ========================================================= */

export async function createRiskControlLink(
  req: Request,
  res: Response
): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const riskId = String(req.params.id ?? "").trim();
  if (!isUuid(riskId)) {
    res.status(400).json({ error: "risk_id_must_be_uuid" });
    return;
  }

  const validated = validateRiskControlLinkCreate(req.body);
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }

  const { control_id, note } = validated.input;
  const userId = req.userId ?? null;

  try {
    // Pre-flight: risk must belong to this org. 404 not 403 — no enumeration.
    const riskCheck = await pg.query(
      `SELECT 1 FROM risks WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [riskId, organizationId]
    );
    if ((riskCheck.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "risk_not_found" });
      return;
    }

    // Pre-flight: control must belong to this org. Same 404 posture.
    const controlCheck = await pg.query(
      `SELECT 1 FROM controls WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [control_id, organizationId]
    );
    if ((controlCheck.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "control_not_found" });
      return;
    }

    // Re-link semantics, step 1: is there already a LIVE row? If so, no-op.
    // Returning the existing row with `created: false` means the caller can
    // treat the response uniformly (always gets a link object) without
    // distinguishing first-link from re-link in the happy path.
    const liveCheck = await pg.query(
      `SELECT ${LINK_SELECT}
         FROM risk_control_links
        WHERE organization_id = $1
          AND risk_id = $2
          AND control_id = $3
          AND deleted_at IS NULL
        LIMIT 1`,
      [organizationId, riskId, control_id]
    );
    if ((liveCheck.rowCount ?? 0) > 0) {
      res.status(200).json({ link: liveCheck.rows[0], created: false });
      return;
    }

    // Re-link semantics, step 2: is there a SOFT-DELETED row to undelete?
    // RETURNING serves dual purpose: tells us whether the update hit (rowCount)
    // and gives us the refreshed row to return.
    const undeleteResult = await pg.query(
      `UPDATE risk_control_links
          SET deleted_at         = NULL,
              note               = $4,
              created_by_user_id = $5,
              created_at         = NOW()
        WHERE organization_id = $1
          AND risk_id = $2
          AND control_id = $3
          AND deleted_at IS NOT NULL
        RETURNING ${LINK_SELECT}`,
      [organizationId, riskId, control_id, note, userId]
    );

    let link: Record<string, unknown>;
    let actionForLogger: "undeleted" | "inserted";

    if ((undeleteResult.rowCount ?? 0) > 0) {
      link = undeleteResult.rows[0]!;
      actionForLogger = "undeleted";
    } else {
      // Re-link semantics, step 3: brand-new INSERT.
      const insertResult = await pg.query(
        `INSERT INTO risk_control_links (
           organization_id, risk_id, control_id, note, created_by_user_id
         )
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${LINK_SELECT}`,
        [organizationId, riskId, control_id, note, userId]
      );
      link = insertResult.rows[0]!;
      actionForLogger = "inserted";
    }

    logger.info(
      {
        event: "risk_control_link_created",
        organizationId,
        linkId: link.id,
        riskId,
        controlId: control_id,
        action: actionForLogger
      },
      "Risk-control link created"
    );

    writeAuditEvent({
      organizationId,
      actorApiKeyId: getApiKeyId(req),
      actorUserId:   userId,
      eventType:     "risk_control_link.created",
      resourceType:  "risk_control_link",
      resourceId:    link.id as string,
      payload:       { risk_id: riskId, control_id, note },
      ipAddress:     req.ip ?? null
    });

    res.status(201).json({ link, created: true });
  } catch (err) {
    logger.error(
      { event: "risk_control_link_create_failed", err, riskId, controlId: control_id },
      "POST /api/risks/:id/controls failed"
    );
    res.status(500).json({ error: "risk_control_link_create_failed" });
  }
}

/* =========================================================
   DELETE /api/risks/:id/controls/:controlId
   Soft-delete the live link for (org, risk, control).
   ========================================================= */

export async function deleteRiskControlLink(
  req: Request,
  res: Response
): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const riskId = String(req.params.id ?? "").trim();
  if (!isUuid(riskId)) {
    res.status(400).json({ error: "risk_id_must_be_uuid" });
    return;
  }

  const controlId = String(req.params.controlId ?? "").trim();
  if (!isUuid(controlId)) {
    res.status(400).json({ error: "control_id_must_be_uuid" });
    return;
  }

  try {
    // Soft delete via UPDATE returning the row. A missing live row (cross-org,
    // never existed, or already soft-deleted) all collapse to a uniform 404 to
    // avoid enumeration.
    const result = await pg.query(
      `UPDATE risk_control_links
          SET deleted_at = NOW()
        WHERE organization_id = $1
          AND risk_id = $2
          AND control_id = $3
          AND deleted_at IS NULL
        RETURNING ${LINK_SELECT}`,
      [organizationId, riskId, controlId]
    );

    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "risk_control_link_not_found" });
      return;
    }

    const link = result.rows[0]!;

    logger.info(
      {
        event: "risk_control_link_deleted",
        organizationId,
        linkId: link.id,
        riskId,
        controlId
      },
      "Risk-control link deleted"
    );

    writeAuditEvent({
      organizationId,
      actorApiKeyId: getApiKeyId(req),
      actorUserId:   req.userId ?? null,
      eventType:     "risk_control_link.deleted",
      resourceType:  "risk_control_link",
      resourceId:    link.id as string,
      payload:       { risk_id: riskId, control_id: controlId },
      ipAddress:     req.ip ?? null
    });

    res.status(204).send();
  } catch (err) {
    logger.error(
      { event: "risk_control_link_delete_failed", err, riskId, controlId },
      "DELETE /api/risks/:id/controls/:controlId failed"
    );
    res.status(500).json({ error: "risk_control_link_delete_failed" });
  }
}

/* =========================================================
   GET /api/risks/:id/controls
   List controls mitigating this risk.
   ========================================================= */

export async function listControlsForRisk(
  req: Request,
  res: Response
): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const riskId = String(req.params.id ?? "").trim();
  if (!isUuid(riskId)) {
    res.status(400).json({ error: "risk_id_must_be_uuid" });
    return;
  }

  const limit = parseLimit(req.query.limit);
  if (limit === null) {
    res.status(400).json({
      error: "invalid_limit",
      detail: "limit must be a positive integer"
    });
    return;
  }

  try {
    const riskCheck = await pg.query(
      `SELECT 1 FROM risks WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [riskId, organizationId]
    );
    if ((riskCheck.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "risk_not_found" });
      return;
    }

    // LEFT JOIN users so the picker / list shows who linked it (degrades
    // gracefully when created_by_user_id is null or the user was deleted).
    // Control fields kept narrow — full control fetch is /api/controls/:id.
    const result = await pg.query(
      `SELECT
         rcl.id              AS link_id,
         rcl.note            AS note,
         rcl.created_at      AS link_created_at,
         rcl.created_by_user_id,
         u.email             AS created_by_email,
         u.name              AS created_by_name,
         c.id                AS control_id,
         c.name              AS control_name,
         c.status            AS control_status,
         c.domain            AS control_domain,
         c.control_family    AS control_family,
         c.maturity_level    AS control_maturity_level
         FROM risk_control_links rcl
         JOIN controls c ON c.id = rcl.control_id
         LEFT JOIN users u ON u.id = rcl.created_by_user_id
        WHERE rcl.organization_id = $1
          AND rcl.risk_id = $2
          AND rcl.deleted_at IS NULL
          AND c.organization_id = $1
        ORDER BY rcl.created_at DESC, rcl.id DESC
        LIMIT $3`,
      [organizationId, riskId, limit]
    );

    res.status(200).json({
      count: result.rows.length,
      limit,
      organizationId,
      riskId,
      links: result.rows
    });
  } catch (err) {
    logger.error(
      { event: "risk_linked_controls_failed", err, riskId },
      "GET /api/risks/:id/controls failed"
    );
    res.status(500).json({ error: "risk_linked_controls_failed" });
  }
}

/* =========================================================
   GET /api/controls/:id/risks (inverse)
   List risks mitigated by this control.
   ========================================================= */

export async function listRisksForControl(
  req: Request,
  res: Response
): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const controlId = String(req.params.id ?? "").trim();
  if (!isUuid(controlId)) {
    res.status(400).json({ error: "control_id_must_be_uuid" });
    return;
  }

  const limit = parseLimit(req.query.limit);
  if (limit === null) {
    res.status(400).json({
      error: "invalid_limit",
      detail: "limit must be a positive integer"
    });
    return;
  }

  try {
    const controlCheck = await pg.query(
      `SELECT 1 FROM controls WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [controlId, organizationId]
    );
    if ((controlCheck.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "control_not_found" });
      return;
    }

    // Risk fields kept narrow — title + status + residual_rating are enough
    // for the read-only "Risks Mitigated" sidebar card. Full risk fetch is
    // /api/risks/:id.
    const result = await pg.query(
      `SELECT
         rcl.id              AS link_id,
         rcl.note            AS note,
         rcl.created_at      AS link_created_at,
         r.id                AS risk_id,
         r.title             AS risk_title,
         r.status            AS risk_status,
         r.residual_rating   AS risk_residual_rating,
         r.domain            AS risk_domain
         FROM risk_control_links rcl
         JOIN risks r ON r.id = rcl.risk_id
        WHERE rcl.organization_id = $1
          AND rcl.control_id = $2
          AND rcl.deleted_at IS NULL
          AND r.organization_id = $1
        ORDER BY rcl.created_at DESC, rcl.id DESC
        LIMIT $3`,
      [organizationId, controlId, limit]
    );

    res.status(200).json({
      count: result.rows.length,
      limit,
      organizationId,
      controlId,
      links: result.rows
    });
  } catch (err) {
    logger.error(
      { event: "control_linked_risks_failed", err, controlId },
      "GET /api/controls/:id/risks failed"
    );
    res.status(500).json({ error: "control_linked_risks_failed" });
  }
}

/* =========================================================
   Router wiring — handlers above are exported by name for
   targeted behavioral tests.
   ========================================================= */

router.post(
  "/risks/:id/controls",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  createRiskControlLink
);

router.delete(
  "/risks/:id/controls/:controlId",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  deleteRiskControlLink
);

router.get(
  "/risks/:id/controls",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  listControlsForRisk
);

router.get(
  "/controls/:id/risks",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  listRisksForControl
);

export default router;
