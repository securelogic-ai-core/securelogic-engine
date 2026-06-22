/**
 * signalAiSystemLinks.ts — Tenant-scoped linkage between cyber_signals and ai_systems.
 *
 * Continuation of BUILD_SEQUENCE.md Priority 5 (signal-to-platform-linkage).
 * Mirrors the signalVendorLinks pattern proven by signal-to-vendor-linkage.
 * Use case: link a MITRE ATLAS or other AI-targeting threat signal to the
 * specific deployed AI systems in an org that the signal applies to. Enables
 * read-back in both directions for downstream surfaces.
 *
 * ROUTES
 *   POST   /api/signal-ai-system-links          — create a link
 *   DELETE /api/signal-ai-system-links/:id      — soft-delete a link (deleted_at)
 *   GET    /api/ai-systems/:id/signals          — signals linked to an AI system
 *   GET    /api/cyber-signals/:id/ai-systems    — AI systems linked to a signal
 *
 * TENANT RULES (TENANT_ISOLATION_STANDARD.md §1, §4, §8)
 *   - organization_id is sourced from req.organizationContext, never from the
 *     request body or any user-supplied parameter.
 *   - AI system must belong to the requesting org. Cross-org returns 404 (not
 *     403) to avoid enumeration.
 *   - Signal must belong to the requesting org OR be a global signal
 *     (cyber_signals.organization_id IS NULL); global signals are explicitly
 *     cross-org-visible per §1. The cross-row pre-flight handles this
 *     asymmetry — same posture as signal_vendor_links.
 *   - Audit-log every create and delete via writeAuditEvent.
 *
 * HANDLERS ARE NAMED EXPORTS so the targeted behavioral tests in
 * signalAiSystemLinks.test.ts can invoke them directly with mocked pg.
 *
 * NOT IN SCOPE FOR THIS PACKAGE
 *   - Auto-linking from cyberSignalProcessingService (the existing fuzzy
 *     AI-system matcher continues to operate independently and is not modified).
 *   - Bulk endpoints, backfill, posture/brief surfacing, UI work.
 *   - Linkage to controls, obligations, risks, findings — separate slices.
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  validateSignalAiSystemLinkCreate,
  isUuid
} from "../lib/signalAiSystemLinkValidation.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const INTEGER_RE = /^-?\d+$/;

const LINK_SELECT = `
  id,
  organization_id,
  signal_id,
  ai_system_id,
  note,
  created_by_user_id,
  created_at,
  deleted_at
`;

const SIGNAL_SELECT = `
  id,
  organization_id,
  source,
  signal_type,
  severity,
  normalized_summary,
  affected_vendor,
  affected_cve,
  ingestion_timestamp,
  processed,
  created_at
`;

const AI_SYSTEM_SELECT = `
  id,
  organization_id,
  name,
  criticality,
  deployment_status,
  risk_classification,
  created_at
`;

/**
 * Parse a `?limit=` query string. Returns:
 *   - DEFAULT_LIMIT when absent or empty.
 *   - DEFAULT_LIMIT when a valid integer ≤ 0 (preserve prior tolerance for "0" / "-1").
 *   - clamped value (≤ MAX_LIMIT) when a valid positive integer.
 *   - null when the input is non-integer (fractional or non-numeric); the route
 *     handler converts null to a 400 invalid_limit response. Postgres rejects
 *     fractional LIMIT with a runtime error, so we must reject before the SQL.
 */
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

/* =========================================================
   POST /api/signal-ai-system-links
   Create a tenant-scoped link between a cyber signal and an AI system.

   Idempotent on (organization_id, signal_id, ai_system_id) where
   deleted_at IS NULL — second call returns the existing live row.
   Atomic via ON CONFLICT against the partial unique index — no
   SELECT-then-INSERT race.
   ========================================================= */

export async function createSignalAiSystemLink(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const validated = validateSignalAiSystemLinkCreate(req.body);
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }

  const { signal_id, ai_system_id, note } = validated.input;

  try {
    // Pre-flight: AI system must belong to this org. 404 not 403 — no enumeration.
    const aiSystemCheck = await pg.query(
      `SELECT 1 FROM ai_systems WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [ai_system_id, organizationId]
    );
    if ((aiSystemCheck.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "ai_system_not_found" });
      return;
    }

    // Pre-flight: signal must be same-org OR global (organization_id IS NULL).
    // Asymmetry is intentional — public-source threat signals (e.g. MITRE
    // ATLAS, NVD) are visible to every org and may be linked to any org's
    // AI systems. Mirrors signal_vendor_links per TENANT_ISOLATION_STANDARD.md §1.
    const signalCheck = await pg.query(
      `SELECT 1 FROM cyber_signals
        WHERE id = $1
          AND (organization_id = $2 OR organization_id IS NULL)
        LIMIT 1`,
      [signal_id, organizationId]
    );
    if ((signalCheck.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "cyber_signal_not_found" });
      return;
    }

    // Atomic upsert. ON CONFLICT against the partial unique index
    // idx_signal_ai_system_links_unique_active eliminates the
    // SELECT-then-INSERT race. If a live link already exists,
    // rowCount=0 and we read it back; otherwise the new row returns.
    const insertResult = await pg.query(
      `INSERT INTO signal_ai_system_links (
         organization_id, signal_id, ai_system_id, note, created_by_user_id
       )
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (organization_id, signal_id, ai_system_id)
         WHERE deleted_at IS NULL
         DO NOTHING
       RETURNING ${LINK_SELECT}`,
      [organizationId, signal_id, ai_system_id, note, req.userId ?? null]
    );

    if ((insertResult.rowCount ?? 0) === 0) {
      // Conflict on partial unique index — a live link already exists.
      const existing = await pg.query(
        `SELECT ${LINK_SELECT}
           FROM signal_ai_system_links
          WHERE organization_id = $1
            AND signal_id = $2
            AND ai_system_id = $3
            AND deleted_at IS NULL
          LIMIT 1`,
        [organizationId, signal_id, ai_system_id]
      );
      res.status(200).json({ link: existing.rows[0], created: false });
      return;
    }

    const link = insertResult.rows[0];

    logger.info(
      {
        event: "signal_ai_system_link_created",
        organizationId,
        linkId: link.id,
        signalId: signal_id,
        aiSystemId: ai_system_id
      },
      "Signal-AI-system link created"
    );

    writeAuditEvent({
      organizationId,
      actorApiKeyId: (req as unknown as { apiKey?: { id?: string } }).apiKey?.id ?? null,
      actorUserId: req.userId ?? null,
      eventType: "signal_ai_system_link.created",
      resourceType: "signal_ai_system_link",
      resourceId: link.id as string,
      payload: { signal_id, ai_system_id },
      ipAddress: req.ip ?? null
    });

    res.status(201).json({ link, created: true });
  } catch (err) {
    logger.error(
      { event: "signal_ai_system_link_create_failed", err },
      "POST /api/signal-ai-system-links failed"
    );
    res.status(500).json({ error: "signal_ai_system_link_create_failed" });
  }
}

/* =========================================================
   DELETE /api/signal-ai-system-links/:id
   Soft-delete a link belonging to the requesting organization.
   ========================================================= */

export async function deleteSignalAiSystemLink(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const linkId = String(req.params.id ?? "").trim();
  if (!isUuid(linkId)) {
    res.status(400).json({ error: "link_id_must_be_uuid" });
    return;
  }

  try {
    const result = await pg.query(
      `UPDATE signal_ai_system_links
          SET deleted_at = NOW()
        WHERE id = $1
          AND organization_id = $2
          AND deleted_at IS NULL
        RETURNING ${LINK_SELECT}`,
      [linkId, organizationId]
    );

    if ((result.rowCount ?? 0) === 0) {
      // Cross-org link, non-existent id, or already-deleted — return 404
      // uniformly to avoid enumeration.
      res.status(404).json({ error: "signal_ai_system_link_not_found" });
      return;
    }

    const link = result.rows[0];

    logger.info(
      {
        event: "signal_ai_system_link_deleted",
        organizationId,
        linkId: link.id,
        signalId: link.signal_id,
        aiSystemId: link.ai_system_id
      },
      "Signal-AI-system link deleted"
    );

    writeAuditEvent({
      organizationId,
      actorApiKeyId: (req as unknown as { apiKey?: { id?: string } }).apiKey?.id ?? null,
      actorUserId: req.userId ?? null,
      eventType: "signal_ai_system_link.deleted",
      resourceType: "signal_ai_system_link",
      resourceId: link.id as string,
      payload: {
        signal_id: link.signal_id,
        ai_system_id: link.ai_system_id
      },
      ipAddress: req.ip ?? null
    });

    res.status(200).json({ link });
  } catch (err) {
    logger.error(
      { event: "signal_ai_system_link_delete_failed", err },
      "DELETE /api/signal-ai-system-links/:id failed"
    );
    res.status(500).json({ error: "signal_ai_system_link_delete_failed" });
  }
}

/* =========================================================
   GET /api/ai-systems/:id/signals
   List cyber signals linked to an AI system in this organization.
   Returns same-org signals AND global (NULL-org) signals that have
   been linked — see asymmetry note above.
   ========================================================= */

export async function listSignalsForAiSystem(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const aiSystemId = String(req.params.id ?? "").trim();
  if (!isUuid(aiSystemId)) {
    res.status(400).json({ error: "ai_system_id_must_be_uuid" });
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
    const aiSystemCheck = await pg.query(
      `SELECT 1 FROM ai_systems WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [aiSystemId, organizationId]
    );
    if ((aiSystemCheck.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "ai_system_not_found" });
      return;
    }

    const result = await pg.query(
      `SELECT
         sasl.id           AS link_id,
         sasl.note         AS link_note,
         sasl.created_at   AS link_created_at,
         ${SIGNAL_SELECT.split(",").map((c) => `cs.${c.trim()}`).join(",\n           ")}
         FROM signal_ai_system_links sasl
         JOIN cyber_signals cs ON cs.id = sasl.signal_id
        WHERE sasl.organization_id = $1
          AND sasl.ai_system_id = $2
          AND sasl.deleted_at IS NULL
          AND (cs.organization_id = $1 OR cs.organization_id IS NULL)
        ORDER BY sasl.created_at DESC, sasl.id DESC
        LIMIT $3`,
      [organizationId, aiSystemId, limit]
    );

    res.status(200).json({
      count: result.rows.length,
      limit,
      organizationId,
      aiSystemId,
      signals: result.rows
    });
  } catch (err) {
    logger.error(
      { event: "ai_system_linked_signals_failed", err },
      "GET /api/ai-systems/:id/signals failed"
    );
    res.status(500).json({ error: "ai_system_linked_signals_failed" });
  }
}

/* =========================================================
   GET /api/cyber-signals/:id/ai-systems
   List AI systems linked to a cyber signal in this organization.
   ========================================================= */

export async function listAiSystemsForSignal(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const signalId = String(req.params.id ?? "").trim();
  if (!isUuid(signalId)) {
    res.status(400).json({ error: "signal_id_must_be_uuid" });
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
    const signalCheck = await pg.query(
      `SELECT 1 FROM cyber_signals
        WHERE id = $1
          AND (organization_id = $2 OR organization_id IS NULL)
        LIMIT 1`,
      [signalId, organizationId]
    );
    if ((signalCheck.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "cyber_signal_not_found" });
      return;
    }

    const result = await pg.query(
      `SELECT
         sasl.id           AS link_id,
         sasl.note         AS link_note,
         sasl.created_at   AS link_created_at,
         ${AI_SYSTEM_SELECT.split(",").map((c) => `ais.${c.trim()}`).join(",\n           ")}
         FROM signal_ai_system_links sasl
         JOIN ai_systems ais ON ais.id = sasl.ai_system_id
        WHERE sasl.organization_id = $1
          AND sasl.signal_id = $2
          AND sasl.deleted_at IS NULL
          AND ais.organization_id = $1
        ORDER BY sasl.created_at DESC, sasl.id DESC
        LIMIT $3`,
      [organizationId, signalId, limit]
    );

    res.status(200).json({
      count: result.rows.length,
      limit,
      organizationId,
      signalId,
      ai_systems: result.rows
    });
  } catch (err) {
    logger.error(
      { event: "signal_linked_ai_systems_failed", err },
      "GET /api/cyber-signals/:id/ai-systems failed"
    );
    res.status(500).json({ error: "signal_linked_ai_systems_failed" });
  }
}

/* =========================================================
   Router wiring — handlers above are exported by name for
   direct invocation in targeted behavioral tests.
   ========================================================= */

router.post(
  "/signal-ai-system-links",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  createSignalAiSystemLink
);

router.delete(
  "/signal-ai-system-links/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  deleteSignalAiSystemLink
);

router.get(
  "/ai-systems/:id/signals",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  listSignalsForAiSystem
);

router.get(
  "/cyber-signals/:id/ai-systems",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  listAiSystemsForSignal
);

export default router;
