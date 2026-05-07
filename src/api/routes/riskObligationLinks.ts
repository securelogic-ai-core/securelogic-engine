/**
 * riskObligationLinks.ts — Tenant-scoped linkage between risks and obligations (RR-6).
 *
 * Mechanical mirror of riskControlLinks.ts (RR-4) — same shape, same re-link
 * semantics, same audit envelope. Only the FK column / route paths / event
 * type strings change. The underlying join-table pattern (May 2026 link-table
 * standard) is identical.
 *
 * ROUTES (nested under risks / obligations; the URL carries the parent IDs)
 *   POST   /api/risks/:id/obligations
 *            Body: { obligation_id: UUID, note?: string<=500 }
 *            Idempotent — see "RE-LINK SEMANTICS" below.
 *   DELETE /api/risks/:id/obligations/:obligationId
 *            Soft-delete. 404 on already-deleted or never-existed.
 *   GET    /api/risks/:id/obligations
 *            Forward direction — obligations affected by this risk.
 *   GET    /api/obligations/:id/risks
 *            Inverse direction — risks affecting this obligation.
 *
 * RE-LINK SEMANTICS (matches RR-4)
 *   1. Live row already exists for (org, risk, obligation)
 *        → 200, return existing row, NO audit event (no-op).
 *   2. Soft-deleted row exists (deleted_at IS NOT NULL)
 *        → UPDATE deleted_at = NULL, refresh note, created_by_user_id,
 *          created_at; emit risk_obligation_link.created.
 *   3. No row exists
 *        → INSERT; emit risk_obligation_link.created.
 *
 * TENANT RULES (TENANT_ISOLATION_STANDARD.md §1, §4, §8)
 *   - organization_id is sourced from req.organizationContext, never from
 *     the request body or any user-supplied parameter.
 *   - risk and obligation must both belong to the requesting org. Cross-org
 *     returns 404 (not 403) to avoid enumeration.
 *   - Audit-log every create / soft-delete via writeAuditEvent. Same shape
 *     as RR-4: payload is { risk_id, obligation_id [, note] }.
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  validateRiskObligationLinkCreate,
  isUuid,
} from "../lib/riskObligationLinkValidation.js";

const router = Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const INTEGER_RE = /^-?\d+$/;

const LINK_SELECT = `
  id,
  organization_id,
  risk_id,
  obligation_id,
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
   POST /api/risks/:id/obligations
   Link a risk to an obligation (idempotent).
   ========================================================= */

export async function createRiskObligationLink(
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

  const validated = validateRiskObligationLinkCreate(req.body);
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }

  const { obligation_id, note } = validated.input;
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

    // Pre-flight: obligation must belong to this org. Same 404 posture.
    const obligationCheck = await pg.query(
      `SELECT 1 FROM obligations WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [obligation_id, organizationId]
    );
    if ((obligationCheck.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "obligation_not_found" });
      return;
    }

    // Re-link semantics, step 1: is there already a LIVE row? If so, no-op.
    const liveCheck = await pg.query(
      `SELECT ${LINK_SELECT}
         FROM risk_obligation_links
        WHERE organization_id = $1
          AND risk_id = $2
          AND obligation_id = $3
          AND deleted_at IS NULL
        LIMIT 1`,
      [organizationId, riskId, obligation_id]
    );
    if ((liveCheck.rowCount ?? 0) > 0) {
      res.status(200).json({ link: liveCheck.rows[0], created: false });
      return;
    }

    // Re-link semantics, step 2: is there a SOFT-DELETED row to undelete?
    const undeleteResult = await pg.query(
      `UPDATE risk_obligation_links
          SET deleted_at         = NULL,
              note               = $4,
              created_by_user_id = $5,
              created_at         = NOW()
        WHERE organization_id = $1
          AND risk_id = $2
          AND obligation_id = $3
          AND deleted_at IS NOT NULL
        RETURNING ${LINK_SELECT}`,
      [organizationId, riskId, obligation_id, note, userId]
    );

    let link: Record<string, unknown>;
    let actionForLogger: "undeleted" | "inserted";

    if ((undeleteResult.rowCount ?? 0) > 0) {
      link = undeleteResult.rows[0]!;
      actionForLogger = "undeleted";
    } else {
      // Re-link semantics, step 3: brand-new INSERT.
      const insertResult = await pg.query(
        `INSERT INTO risk_obligation_links (
           organization_id, risk_id, obligation_id, note, created_by_user_id
         )
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${LINK_SELECT}`,
        [organizationId, riskId, obligation_id, note, userId]
      );
      link = insertResult.rows[0]!;
      actionForLogger = "inserted";
    }

    logger.info(
      {
        event: "risk_obligation_link_created",
        organizationId,
        linkId: link.id,
        riskId,
        obligationId: obligation_id,
        action: actionForLogger
      },
      "Risk-obligation link created"
    );

    writeAuditEvent({
      organizationId,
      actorApiKeyId: getApiKeyId(req),
      actorUserId:   userId,
      eventType:     "risk_obligation_link.created",
      resourceType:  "risk_obligation_link",
      resourceId:    link.id as string,
      payload:       { risk_id: riskId, obligation_id, note },
      ipAddress:     req.ip ?? null
    });

    res.status(201).json({ link, created: true });
  } catch (err) {
    logger.error(
      { event: "risk_obligation_link_create_failed", err, riskId, obligationId: obligation_id },
      "POST /api/risks/:id/obligations failed"
    );
    res.status(500).json({ error: "risk_obligation_link_create_failed" });
  }
}

/* =========================================================
   DELETE /api/risks/:id/obligations/:obligationId
   Soft-delete the live link for (org, risk, obligation).
   ========================================================= */

export async function deleteRiskObligationLink(
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

  const obligationId = String(req.params.obligationId ?? "").trim();
  if (!isUuid(obligationId)) {
    res.status(400).json({ error: "obligation_id_must_be_uuid" });
    return;
  }

  try {
    const result = await pg.query(
      `UPDATE risk_obligation_links
          SET deleted_at = NOW()
        WHERE organization_id = $1
          AND risk_id = $2
          AND obligation_id = $3
          AND deleted_at IS NULL
        RETURNING ${LINK_SELECT}`,
      [organizationId, riskId, obligationId]
    );

    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "risk_obligation_link_not_found" });
      return;
    }

    const link = result.rows[0]!;

    logger.info(
      {
        event: "risk_obligation_link_deleted",
        organizationId,
        linkId: link.id,
        riskId,
        obligationId
      },
      "Risk-obligation link deleted"
    );

    writeAuditEvent({
      organizationId,
      actorApiKeyId: getApiKeyId(req),
      actorUserId:   req.userId ?? null,
      eventType:     "risk_obligation_link.deleted",
      resourceType:  "risk_obligation_link",
      resourceId:    link.id as string,
      payload:       { risk_id: riskId, obligation_id: obligationId },
      ipAddress:     req.ip ?? null
    });

    res.status(204).send();
  } catch (err) {
    logger.error(
      { event: "risk_obligation_link_delete_failed", err, riskId, obligationId },
      "DELETE /api/risks/:id/obligations/:obligationId failed"
    );
    res.status(500).json({ error: "risk_obligation_link_delete_failed" });
  }
}

/* =========================================================
   GET /api/risks/:id/obligations
   List obligations affected by this risk.
   ========================================================= */

export async function listObligationsForRisk(
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

    // LEFT JOIN users so the picker / list shows who linked it. Obligation
    // fields kept narrow — full obligation fetch is /api/obligations/:id.
    // source_regulation included per V3 finding (canonical short-form ref).
    const result = await pg.query(
      `SELECT
         rol.id                  AS link_id,
         rol.note                AS note,
         rol.created_at          AS link_created_at,
         rol.created_by_user_id,
         u.email                 AS created_by_email,
         u.name                  AS created_by_name,
         o.id                    AS obligation_id,
         o.title                 AS obligation_title,
         o.source_regulation     AS obligation_source_regulation,
         o.jurisdiction          AS obligation_jurisdiction,
         o.domain                AS obligation_domain,
         o.status                AS obligation_status,
         o.priority              AS obligation_priority
         FROM risk_obligation_links rol
         JOIN obligations o ON o.id = rol.obligation_id
         LEFT JOIN users u ON u.id = rol.created_by_user_id
        WHERE rol.organization_id = $1
          AND rol.risk_id = $2
          AND rol.deleted_at IS NULL
          AND o.organization_id = $1
        ORDER BY rol.created_at DESC, rol.id DESC
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
      { event: "risk_linked_obligations_failed", err, riskId },
      "GET /api/risks/:id/obligations failed"
    );
    res.status(500).json({ error: "risk_linked_obligations_failed" });
  }
}

/* =========================================================
   GET /api/obligations/:id/risks (inverse)
   List risks affecting this obligation.
   ========================================================= */

export async function listRisksForObligation(
  req: Request,
  res: Response
): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const obligationId = String(req.params.id ?? "").trim();
  if (!isUuid(obligationId)) {
    res.status(400).json({ error: "obligation_id_must_be_uuid" });
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
    const obligationCheck = await pg.query(
      `SELECT 1 FROM obligations WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [obligationId, organizationId]
    );
    if ((obligationCheck.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "obligation_not_found" });
      return;
    }

    // Risk fields kept narrow — title + status + residual_rating are enough
    // for the read-only "Risks Linked" sidebar card. Full risk fetch is
    // /api/risks/:id.
    const result = await pg.query(
      `SELECT
         rol.id              AS link_id,
         rol.note            AS note,
         rol.created_at      AS link_created_at,
         r.id                AS risk_id,
         r.title             AS risk_title,
         r.status            AS risk_status,
         r.residual_rating   AS risk_residual_rating,
         r.domain            AS risk_domain
         FROM risk_obligation_links rol
         JOIN risks r ON r.id = rol.risk_id
        WHERE rol.organization_id = $1
          AND rol.obligation_id = $2
          AND rol.deleted_at IS NULL
          AND r.organization_id = $1
        ORDER BY rol.created_at DESC, rol.id DESC
        LIMIT $3`,
      [organizationId, obligationId, limit]
    );

    res.status(200).json({
      count: result.rows.length,
      limit,
      organizationId,
      obligationId,
      links: result.rows
    });
  } catch (err) {
    logger.error(
      { event: "obligation_linked_risks_failed", err, obligationId },
      "GET /api/obligations/:id/risks failed"
    );
    res.status(500).json({ error: "obligation_linked_risks_failed" });
  }
}

/* =========================================================
   Router wiring — handlers above are exported by name for
   targeted behavioral tests.
   ========================================================= */

router.post(
  "/risks/:id/obligations",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  createRiskObligationLink
);

router.delete(
  "/risks/:id/obligations/:obligationId",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  deleteRiskObligationLink
);

router.get(
  "/risks/:id/obligations",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  listObligationsForRisk
);

router.get(
  "/obligations/:id/risks",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  listRisksForObligation
);

export default router;
