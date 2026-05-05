/**
 * signalMatchSuggestions.ts — Tenant-scoped accept/dismiss workflow for
 * matcher-produced suggestions that an external cyber_signal relates to a
 * specific platform entity (vendor, ai_system, control, obligation).
 *
 * Mirrors the hardened template established by signal-to-vendor-linkage /
 * signal-to-AI-system-linkage / signal-to-control-linkage / signal-to-
 * obligation-linkage and confirmed in production by link-route-template-
 * hardening. Polymorphic dispatch by target_type — same shape as findings
 * (source_type/source_id) and evidence (source_type/source_id).
 *
 * ROUTES
 *   GET    /api/signal-match-suggestions               — list suggestions for the org
 *   POST   /api/signal-match-suggestions/:id/accept    — accept; creates the link row in one tx
 *   POST   /api/signal-match-suggestions/:id/dismiss   — dismiss; terminal state
 *
 * TENANT RULES (TENANT_ISOLATION_STANDARD.md §1, §4, §8)
 *   - organization_id is sourced from req.organizationContext, never from the
 *     request body or any user-supplied parameter.
 *   - Suggestions are scoped by organization_id on every read and write.
 *     Cross-org access returns 404 (not 403) to avoid enumeration.
 *   - The accept handler verifies the target row (vendor/ai_system/control/
 *     obligation) belongs to the requesting org before writing the link.
 *   - The accept handler verifies the cyber_signal belongs to the requesting
 *     org OR is a global signal (organization_id IS NULL) — same asymmetry
 *     as the four link slices, per §1.
 *   - Audit-log every state transition (accept, dismiss) via writeAuditEvent.
 *
 * ATOMICITY
 *   The accept handler is the FIRST code path in this codebase that writes
 *   to a signal_*_links table from a non-route caller (the link routes are
 *   user-POST only). The handler runs the suggestion-state UPDATE and the
 *   link-table INSERT inside a single transaction. SELECT FOR UPDATE on
 *   the suggestion row prevents concurrent accept/dismiss on the same row.
 *   The link INSERT uses ON CONFLICT (...) DO NOTHING RETURNING against the
 *   link table's existing partial unique index — same hardened pattern as
 *   the link routes themselves. If a live link already exists (because the
 *   user manually created it via the link route before accepting), the
 *   accept handler reads the existing link id, sets accepted_link_id, and
 *   returns 200 with the existing link.
 *
 * HANDLERS ARE NAMED EXPORTS so the targeted behavioral tests in
 * signalMatchSuggestions.test.ts can invoke them directly with mocked pg.
 *
 * NOT IN SCOPE FOR THIS PACKAGE
 *   - The matcher itself. Today there is no code path that INSERTs into
 *     signal_match_suggestions; the matcher rewire is a separate package.
 *     This package lands the table, the validation lib, the route, the
 *     audit hooks, and the canonical-model row so the matcher work has a
 *     stable target to write against.
 *   - Bulk endpoints, backfill, posture/brief surfacing, UI work.
 *   - Per-target-type sidecar tables for forensic-grade link-row provenance
 *     (Option B in the design discussion). Revisit if/when CSV-export
 *     provenance or read-replica-without-suggestions becomes a hard
 *     requirement; do not pre-build for it.
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  validateSignalMatchSuggestionAccept,
  validateSignalMatchSuggestionDismiss,
  isUuid,
  isTargetType,
  type TargetType
} from "../lib/signalMatchSuggestionValidation.js";
import {
  computeRiskScore,
  DEFAULT_WEIGHTS,
  type RiskScoringWeights
} from "../lib/riskScoring.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const INTEGER_RE = /^-?\d+$/;

const SUGGESTION_SELECT = `
  id,
  organization_id,
  signal_id,
  target_type,
  target_id,
  match_reason,
  match_score,
  created_at,
  accepted_at,
  accepted_by_user_id,
  accepted_link_id,
  dismissed_at,
  dismissed_by_user_id,
  dismissal_reason
`;

/**
 * Closed dispatch table from target_type to the link table the accept handler
 * writes into, the FK column on that table, and the source-entity table used
 * for the same-org pre-flight. All values are compile-time constants — no
 * user input is ever interpolated into a SQL identifier. Adding a new
 * target_type requires updating this map AND the CHECK constraint in the
 * migration.
 */
const TARGET_DISPATCH: Record<
  TargetType,
  { linkTable: string; targetCol: string; sourceTable: string; auditResource: string }
> = {
  vendor: {
    linkTable: "signal_vendor_links",
    targetCol: "vendor_id",
    sourceTable: "vendors",
    auditResource: "signal_vendor_link"
  },
  ai_system: {
    linkTable: "signal_ai_system_links",
    targetCol: "ai_system_id",
    sourceTable: "ai_systems",
    auditResource: "signal_ai_system_link"
  },
  control: {
    linkTable: "signal_control_links",
    targetCol: "control_id",
    sourceTable: "controls",
    auditResource: "signal_control_link"
  },
  obligation: {
    linkTable: "signal_obligation_links",
    targetCol: "obligation_id",
    sourceTable: "obligations",
    auditResource: "signal_obligation_link"
  }
};

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

function getApiKeyId(req: Request): string | null {
  return (req as unknown as { apiKey?: { id?: string } }).apiKey?.id ?? null;
}

/* =========================================================
   GET /api/signal-match-suggestions
   List suggestions for the requesting organization.

   Query params (all optional):
     status        — 'pending' | 'accepted' | 'dismissed' (default: 'pending')
     signal_id     — filter to one signal
     target_type   — filter to one target type
     limit         — 1..100, default 25
   ========================================================= */

export async function listSignalMatchSuggestions(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
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

  const rawStatus = req.query.status;
  const status =
    rawStatus === undefined || rawStatus === null || String(rawStatus).trim() === ""
      ? "pending"
      : String(rawStatus).trim();
  if (status !== "pending" && status !== "accepted" && status !== "dismissed") {
    res.status(400).json({
      error: "invalid_status",
      detail: "status must be one of: pending, accepted, dismissed"
    });
    return;
  }

  const rawSignalId = req.query.signal_id;
  let signalIdFilter: string | null = null;
  if (rawSignalId !== undefined && String(rawSignalId).trim() !== "") {
    if (!isUuid(rawSignalId)) {
      res.status(400).json({ error: "signal_id_must_be_uuid" });
      return;
    }
    signalIdFilter = String(rawSignalId).trim();
  }

  const rawTargetType = req.query.target_type;
  let targetTypeFilter: TargetType | null = null;
  if (rawTargetType !== undefined && String(rawTargetType).trim() !== "") {
    if (!isTargetType(rawTargetType)) {
      res.status(400).json({
        error: "invalid_target_type",
        detail: "target_type must be one of: vendor, ai_system, control, obligation"
      });
      return;
    }
    targetTypeFilter = rawTargetType;
  }

  const stateClause =
    status === "pending"
      ? "accepted_at IS NULL AND dismissed_at IS NULL"
      : status === "accepted"
        ? "accepted_at IS NOT NULL"
        : "dismissed_at IS NOT NULL";

  const params: unknown[] = [organizationId];
  let sql = `
    SELECT ${SUGGESTION_SELECT}
      FROM signal_match_suggestions
     WHERE organization_id = $1
       AND ${stateClause}
  `;
  if (signalIdFilter !== null) {
    params.push(signalIdFilter);
    sql += ` AND signal_id = $${params.length}`;
  }
  if (targetTypeFilter !== null) {
    params.push(targetTypeFilter);
    sql += ` AND target_type = $${params.length}`;
  }
  params.push(limit);
  sql += ` ORDER BY created_at DESC, id DESC LIMIT $${params.length}`;

  try {
    const result = await pg.query(sql, params);
    res.status(200).json({
      count: result.rows.length,
      limit,
      organizationId,
      status,
      suggestions: result.rows
    });
  } catch (err) {
    logger.error(
      { event: "signal_match_suggestions_list_failed", err },
      "GET /api/signal-match-suggestions failed"
    );
    res.status(500).json({ error: "signal_match_suggestions_list_failed" });
  }
}

/* =========================================================
   POST /api/signal-match-suggestions/:id/accept
   Accept a pending suggestion. Atomically:
     1. SELECT FOR UPDATE on the suggestion (must be pending)
     2. Pre-flight target row same-org
     3. Pre-flight signal same-org or global
     4. INSERT into the appropriate signal_*_links table (ON CONFLICT
        against the existing partial unique index → DO NOTHING RETURNING)
     5. If link insert conflicted (live link already exists from a manual
        POST), SELECT the existing live link id
     6. UPDATE suggestion SET accepted_at, accepted_by_user_id, accepted_link_id
     7. COMMIT
   On any error inside the transaction: ROLLBACK and the suggestion stays
   pending. The link insert is idempotent against the link table's partial
   unique index, so concurrent accept attempts do not create duplicate links.
   ========================================================= */

export async function acceptSignalMatchSuggestion(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const suggestionId = String(req.params.id ?? "").trim();
  if (!isUuid(suggestionId)) {
    res.status(400).json({ error: "suggestion_id_must_be_uuid" });
    return;
  }

  const validated = validateSignalMatchSuggestionAccept(req.body);
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }
  const { note } = validated.input;

  const client = await pg.connect();
  try {
    await client.query("BEGIN");

    // 1. Lock the suggestion row. SELECT FOR UPDATE serializes concurrent
    //    accept/dismiss attempts on the same suggestion.
    const suggestionResult = await client.query(
      `SELECT ${SUGGESTION_SELECT}
         FROM signal_match_suggestions
        WHERE id = $1 AND organization_id = $2
        FOR UPDATE`,
      [suggestionId, organizationId]
    );
    if ((suggestionResult.rowCount ?? 0) === 0) {
      // Cross-org or non-existent — 404 uniformly to avoid enumeration.
      await client.query("ROLLBACK");
      res.status(404).json({ error: "signal_match_suggestion_not_found" });
      return;
    }

    const suggestion = suggestionResult.rows[0] as {
      id: string;
      signal_id: string;
      target_type: string;
      target_id: string;
      accepted_at: string | null;
      dismissed_at: string | null;
    };

    if (suggestion.accepted_at !== null) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "signal_match_suggestion_already_accepted" });
      return;
    }
    if (suggestion.dismissed_at !== null) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "signal_match_suggestion_already_dismissed" });
      return;
    }

    if (!isTargetType(suggestion.target_type)) {
      // Defensive: the CHECK constraint should make this impossible, but if a
      // future migration loosens it, fail closed rather than mis-route.
      await client.query("ROLLBACK");
      logger.error(
        { event: "signal_match_suggestion_invalid_target_type", suggestionId, targetType: suggestion.target_type },
        "Suggestion has unrecognized target_type — schema drift?"
      );
      res.status(500).json({ error: "signal_match_suggestion_target_type_unknown" });
      return;
    }
    const dispatch = TARGET_DISPATCH[suggestion.target_type];

    // 2. Pre-flight: target row must belong to this org. 404 not 403.
    const targetCheck = await client.query(
      `SELECT 1 FROM ${dispatch.sourceTable} WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [suggestion.target_id, organizationId]
    );
    if ((targetCheck.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "target_not_found" });
      return;
    }

    // 3. Pre-flight: signal must be same-org OR global (organization_id IS NULL).
    //    Asymmetry intentional — public-source threat signals are visible to
    //    every org per TENANT_ISOLATION_STANDARD.md §1, mirroring the link routes.
    const signalCheck = await client.query(
      `SELECT 1 FROM cyber_signals
        WHERE id = $1
          AND (organization_id = $2 OR organization_id IS NULL)
        LIMIT 1`,
      [suggestion.signal_id, organizationId]
    );
    if ((signalCheck.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "cyber_signal_not_found" });
      return;
    }

    // 4. Atomic upsert into the link table. ON CONFLICT inference targets the
    //    link table's existing partial unique index. If a live link already
    //    exists (e.g., the user manually POSTed the link before accepting the
    //    suggestion), rowCount=0 and we read it back in step 5.
    const linkInsert = await client.query(
      `INSERT INTO ${dispatch.linkTable} (
         organization_id, signal_id, ${dispatch.targetCol}, note, created_by_user_id
       )
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (organization_id, signal_id, ${dispatch.targetCol})
         WHERE deleted_at IS NULL
         DO NOTHING
       RETURNING id, organization_id, signal_id, ${dispatch.targetCol},
                 note, created_by_user_id, created_at, deleted_at`,
      [organizationId, suggestion.signal_id, suggestion.target_id, note, req.userId ?? null]
    );

    let linkRow: Record<string, unknown>;
    let linkAlreadyExisted = false;

    if ((linkInsert.rowCount ?? 0) === 0) {
      // 5. Live link already exists. Read it.
      const existing = await client.query(
        `SELECT id, organization_id, signal_id, ${dispatch.targetCol},
                note, created_by_user_id, created_at, deleted_at
           FROM ${dispatch.linkTable}
          WHERE organization_id = $1
            AND signal_id = $2
            AND ${dispatch.targetCol} = $3
            AND deleted_at IS NULL
          LIMIT 1`,
        [organizationId, suggestion.signal_id, suggestion.target_id]
      );
      if ((existing.rowCount ?? 0) === 0) {
        // Should be impossible — ON CONFLICT fired but no live row exists.
        // Fail closed.
        await client.query("ROLLBACK");
        logger.error(
          {
            event: "signal_match_suggestion_link_conflict_no_row",
            suggestionId,
            targetType: suggestion.target_type,
            organizationId
          },
          "ON CONFLICT fired but no live link row found — invariant violated"
        );
        res.status(500).json({ error: "signal_match_suggestion_link_conflict_no_row" });
        return;
      }
      linkRow = existing.rows[0];
      linkAlreadyExisted = true;
    } else {
      linkRow = linkInsert.rows[0];
    }

    // 6. Mark the suggestion accepted. Re-asserts pending state in WHERE for
    //    belt-and-suspenders concurrency safety on top of FOR UPDATE.
    const updateResult = await client.query(
      `UPDATE signal_match_suggestions
          SET accepted_at = NOW(),
              accepted_by_user_id = $1,
              accepted_link_id = $2
        WHERE id = $3
          AND organization_id = $4
          AND accepted_at IS NULL
          AND dismissed_at IS NULL
        RETURNING ${SUGGESTION_SELECT}`,
      [req.userId ?? null, linkRow.id, suggestionId, organizationId]
    );
    if ((updateResult.rowCount ?? 0) === 0) {
      // Should be impossible — we hold FOR UPDATE on this row.
      await client.query("ROLLBACK");
      logger.error(
        { event: "signal_match_suggestion_accept_update_lost_row", suggestionId, organizationId },
        "Suggestion update returned 0 rows despite FOR UPDATE — invariant violated"
      );
      res.status(500).json({ error: "signal_match_suggestion_accept_failed" });
      return;
    }
    const updatedSuggestion = updateResult.rows[0];

    await client.query("COMMIT");

    logger.info(
      {
        event: "signal_match_suggestion_accepted",
        organizationId,
        suggestionId: updatedSuggestion.id,
        signalId: suggestion.signal_id,
        targetType: suggestion.target_type,
        targetId: suggestion.target_id,
        linkId: linkRow.id,
        linkAlreadyExisted
      },
      "Signal match suggestion accepted"
    );

    writeAuditEvent({
      organizationId,
      actorApiKeyId: getApiKeyId(req),
      actorUserId: req.userId ?? null,
      eventType: "signal_match_suggestion.accepted",
      resourceType: "signal_match_suggestion",
      resourceId: updatedSuggestion.id as string,
      payload: {
        signal_id: suggestion.signal_id,
        target_type: suggestion.target_type,
        target_id: suggestion.target_id,
        link_id: linkRow.id,
        link_already_existed: linkAlreadyExisted
      },
      ipAddress: req.ip ?? null
    });

    // Also audit the link row's creation when the accept produced a new one.
    // The manual link routes audit signal_*_link.created on direct POST; the
    // accept path is the only other writer, so log the same event-shape here
    // for downstream consumers querying link provenance.
    if (!linkAlreadyExisted) {
      writeAuditEvent({
        organizationId,
        actorApiKeyId: getApiKeyId(req),
        actorUserId: req.userId ?? null,
        eventType: `${dispatch.auditResource}.created`,
        resourceType: dispatch.auditResource,
        resourceId: linkRow.id as string,
        payload: {
          signal_id: suggestion.signal_id,
          [dispatch.targetCol]: suggestion.target_id,
          via_suggestion_id: updatedSuggestion.id
        },
        ipAddress: req.ip ?? null
      });
    }

    res.status(200).json({
      suggestion: updatedSuggestion,
      link: linkRow,
      link_already_existed: linkAlreadyExisted
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    logger.error(
      { event: "signal_match_suggestion_accept_failed", err },
      "POST /api/signal-match-suggestions/:id/accept failed"
    );
    res.status(500).json({ error: "signal_match_suggestion_accept_failed" });
  } finally {
    client.release();
  }
}

/* =========================================================
   POST /api/signal-match-suggestions/:id/dismiss
   Dismiss a pending suggestion. Terminal state — once dismissed, the
   suggestion cannot be revived. The matcher may, however, create a new
   pending row for the same (org, signal, target) later, since the partial
   unique index excludes terminal rows.
   ========================================================= */

export async function dismissSignalMatchSuggestion(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const suggestionId = String(req.params.id ?? "").trim();
  if (!isUuid(suggestionId)) {
    res.status(400).json({ error: "suggestion_id_must_be_uuid" });
    return;
  }

  const validated = validateSignalMatchSuggestionDismiss(req.body);
  if ("error" in validated) {
    res.status(400).json(validated);
    return;
  }
  const { dismissal_reason } = validated.input;

  try {
    // Single-statement update — no link table to touch on the dismiss path,
    // so a transaction is not required. Pending-state predicate in WHERE
    // makes the operation idempotent against terminal rows: rowCount=0 either
    // means cross-org/non-existent OR already terminal. Discriminate with a
    // follow-up SELECT for a precise 404/409 error.
    const updateResult = await pg.query(
      `UPDATE signal_match_suggestions
          SET dismissed_at = NOW(),
              dismissed_by_user_id = $1,
              dismissal_reason = $2
        WHERE id = $3
          AND organization_id = $4
          AND accepted_at IS NULL
          AND dismissed_at IS NULL
        RETURNING ${SUGGESTION_SELECT}`,
      [req.userId ?? null, dismissal_reason, suggestionId, organizationId]
    );

    if ((updateResult.rowCount ?? 0) === 0) {
      // Discriminate the failure cause. SELECT scoped to org so cross-org
      // rows look like 404, never leaking existence.
      const existing = await pg.query(
        `SELECT accepted_at, dismissed_at
           FROM signal_match_suggestions
          WHERE id = $1 AND organization_id = $2
          LIMIT 1`,
        [suggestionId, organizationId]
      );
      if ((existing.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "signal_match_suggestion_not_found" });
        return;
      }
      const row = existing.rows[0] as { accepted_at: string | null; dismissed_at: string | null };
      if (row.accepted_at !== null) {
        res.status(409).json({ error: "signal_match_suggestion_already_accepted" });
        return;
      }
      // dismissed_at must be non-null at this point.
      res.status(409).json({ error: "signal_match_suggestion_already_dismissed" });
      return;
    }

    const updatedSuggestion = updateResult.rows[0];

    logger.info(
      {
        event: "signal_match_suggestion_dismissed",
        organizationId,
        suggestionId: updatedSuggestion.id,
        signalId: updatedSuggestion.signal_id,
        targetType: updatedSuggestion.target_type,
        targetId: updatedSuggestion.target_id
      },
      "Signal match suggestion dismissed"
    );

    writeAuditEvent({
      organizationId,
      actorApiKeyId: getApiKeyId(req),
      actorUserId: req.userId ?? null,
      eventType: "signal_match_suggestion.dismissed",
      resourceType: "signal_match_suggestion",
      resourceId: updatedSuggestion.id as string,
      payload: {
        signal_id: updatedSuggestion.signal_id,
        target_type: updatedSuggestion.target_type,
        target_id: updatedSuggestion.target_id,
        dismissal_reason
      },
      ipAddress: req.ip ?? null
    });

    res.status(200).json({ suggestion: updatedSuggestion });
  } catch (err) {
    logger.error(
      { event: "signal_match_suggestion_dismiss_failed", err },
      "POST /api/signal-match-suggestions/:id/dismiss failed"
    );
    res.status(500).json({ error: "signal_match_suggestion_dismiss_failed" });
  }
}

/* =========================================================
   POST /api/signal-match-suggestions/:id/recompute-score
   Recompute match_score for a single pending suggestion using the org's
   current risk_scoring_weights (or defaults if no row exists).

   Reads:
     - the suggestion (must belong to org, must be pending)
     - the cyber_signals row (for severity + source; same-org or global)
     - the entity row by target_type (for criticality / priority;
       must belong to org)
     - the org's risk_scoring_weights row (or DEFAULT_WEIGHTS)

   Writes:
     - match_score on the suggestion (UPDATE WHERE id AND org AND pending).
     - audit event signal_match_suggestion.score_recomputed.

   Returns: { suggestion, score, breakdown, explanation, weights_source }
   where weights_source is 'configured' or 'default'. The breakdown and
   explanation come straight from computeRiskScore so the caller can
   surface a "why is this score X?" tooltip.

   This package does NOT batch-recompute when weights change. The single-
   row primitive here is the foundation for a future batch package.
   ========================================================= */

export async function recomputeSignalMatchSuggestionScore(
  req: Request,
  res: Response
): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const suggestionId = String(req.params.id ?? "").trim();
  if (!isUuid(suggestionId)) {
    res.status(400).json({ error: "suggestion_id_must_be_uuid" });
    return;
  }

  try {
    // 1. Read the suggestion, scoped to org. Discriminate cross-org vs
    //    terminal-state with a follow-up SELECT, same pattern as dismiss.
    const suggestionRow = await pg.query(
      `SELECT ${SUGGESTION_SELECT}
         FROM signal_match_suggestions
        WHERE id = $1 AND organization_id = $2
        LIMIT 1`,
      [suggestionId, organizationId]
    );
    if ((suggestionRow.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "signal_match_suggestion_not_found" });
      return;
    }
    const suggestion = suggestionRow.rows[0] as {
      id: string;
      signal_id: string;
      target_type: string;
      target_id: string;
      accepted_at: string | null;
      dismissed_at: string | null;
    };
    if (suggestion.accepted_at !== null) {
      res.status(409).json({ error: "signal_match_suggestion_already_accepted" });
      return;
    }
    if (suggestion.dismissed_at !== null) {
      res.status(409).json({ error: "signal_match_suggestion_already_dismissed" });
      return;
    }
    if (!isTargetType(suggestion.target_type)) {
      // Defensive — same posture as the accept handler.
      logger.error(
        { event: "signal_match_suggestion_invalid_target_type", suggestionId, targetType: suggestion.target_type },
        "Suggestion has unrecognized target_type — schema drift?"
      );
      res.status(500).json({ error: "signal_match_suggestion_target_type_unknown" });
      return;
    }

    // 2. Read the signal (severity + source). Same-org or global.
    const signalResult = await pg.query<{ severity: string | null; source: string }>(
      `SELECT severity, source FROM cyber_signals
        WHERE id = $1
          AND (organization_id = $2 OR organization_id IS NULL)
        LIMIT 1`,
      [suggestion.signal_id, organizationId]
    );
    if ((signalResult.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "cyber_signal_not_found" });
      return;
    }
    const signalRow = signalResult.rows[0]!;

    // 3. Read the entity row, dispatched by target_type. Tenant scoping
    //    applies to all four target tables.
    let entityCriticality: string | null = null;
    let entityPriority: string | null = null;

    if (suggestion.target_type === "vendor") {
      const r = await pg.query<{ criticality: string | null }>(
        `SELECT criticality FROM vendors WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [suggestion.target_id, organizationId]
      );
      if ((r.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "target_not_found" });
        return;
      }
      entityCriticality = r.rows[0]!.criticality;
    } else if (suggestion.target_type === "ai_system") {
      const r = await pg.query<{ criticality: string | null }>(
        `SELECT criticality FROM ai_systems WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [suggestion.target_id, organizationId]
      );
      if ((r.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "target_not_found" });
        return;
      }
      entityCriticality = r.rows[0]!.criticality;
    } else if (suggestion.target_type === "control") {
      // Controls have no criticality column. Verify same-org existence
      // only; the scoring function defaults entity weight and notes the
      // reason in the explanation.
      const r = await pg.query(
        `SELECT 1 FROM controls WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [suggestion.target_id, organizationId]
      );
      if ((r.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "target_not_found" });
        return;
      }
    } else {
      // obligation
      const r = await pg.query<{ priority: string | null }>(
        `SELECT priority FROM obligations WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [suggestion.target_id, organizationId]
      );
      if ((r.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "target_not_found" });
        return;
      }
      entityPriority = r.rows[0]!.priority;
    }

    // 4. Load the org's weights, or fall back to documented defaults.
    const weightsResult = await pg.query<{
      entity_criticality_weights: RiskScoringWeights["entity_criticality_weights"];
      obligation_priority_weights: RiskScoringWeights["obligation_priority_weights"];
      severity_weights: RiskScoringWeights["severity_weights"];
    }>(
      `SELECT entity_criticality_weights, obligation_priority_weights, severity_weights
         FROM risk_scoring_weights
        WHERE organization_id = $1
        LIMIT 1`,
      [organizationId]
    );
    const usingDefault = (weightsResult.rowCount ?? 0) === 0;
    const weights: RiskScoringWeights = usingDefault
      ? DEFAULT_WEIGHTS
      : {
          entity_criticality_weights: weightsResult.rows[0]!.entity_criticality_weights,
          obligation_priority_weights: weightsResult.rows[0]!.obligation_priority_weights,
          severity_weights: weightsResult.rows[0]!.severity_weights
        };

    // 5. Compute. Pure function — no further DB access.
    const result = computeRiskScore({
      signal: { severity: signalRow.severity, source: signalRow.source },
      entity: {
        type: suggestion.target_type,
        criticality: entityCriticality,
        priority: entityPriority
      },
      weights
    });

    // 6. Persist match_score. Re-asserts pending state in WHERE so a
    //    concurrent accept/dismiss between read and write returns 409,
    //    not a silent score update on a terminal row.
    const updateResult = await pg.query(
      `UPDATE signal_match_suggestions
          SET match_score = $1
        WHERE id = $2
          AND organization_id = $3
          AND accepted_at IS NULL
          AND dismissed_at IS NULL
        RETURNING ${SUGGESTION_SELECT}`,
      [result.score, suggestionId, organizationId]
    );
    if ((updateResult.rowCount ?? 0) === 0) {
      // The state changed between our read and our write. Discriminate.
      const followup = await pg.query(
        `SELECT accepted_at, dismissed_at
           FROM signal_match_suggestions
          WHERE id = $1 AND organization_id = $2
          LIMIT 1`,
        [suggestionId, organizationId]
      );
      if ((followup.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "signal_match_suggestion_not_found" });
        return;
      }
      const row = followup.rows[0] as { accepted_at: string | null; dismissed_at: string | null };
      if (row.accepted_at !== null) {
        res.status(409).json({ error: "signal_match_suggestion_already_accepted" });
        return;
      }
      res.status(409).json({ error: "signal_match_suggestion_already_dismissed" });
      return;
    }
    const updatedSuggestion = updateResult.rows[0];

    logger.info(
      {
        event: "signal_match_suggestion_score_recomputed",
        organizationId,
        suggestionId: updatedSuggestion.id,
        signalId: suggestion.signal_id,
        targetType: suggestion.target_type,
        targetId: suggestion.target_id,
        score: result.score,
        weightsSource: usingDefault ? "default" : "configured"
      },
      "Signal match suggestion score recomputed"
    );

    writeAuditEvent({
      organizationId,
      actorApiKeyId: getApiKeyId(req),
      actorUserId: req.userId ?? null,
      eventType: "signal_match_suggestion.score_recomputed",
      resourceType: "signal_match_suggestion",
      resourceId: updatedSuggestion.id as string,
      payload: {
        signal_id: suggestion.signal_id,
        target_type: suggestion.target_type,
        target_id: suggestion.target_id,
        score: result.score,
        breakdown: result.breakdown,
        weights_source: usingDefault ? "default" : "configured"
      },
      ipAddress: req.ip ?? null
    });

    res.status(200).json({
      suggestion: updatedSuggestion,
      score: result.score,
      breakdown: result.breakdown,
      explanation: result.explanation,
      weights_source: usingDefault ? "default" : "configured"
    });
  } catch (err) {
    logger.error(
      { event: "signal_match_suggestion_recompute_failed", err },
      "POST /api/signal-match-suggestions/:id/recompute-score failed"
    );
    res.status(500).json({ error: "signal_match_suggestion_recompute_failed" });
  }
}

/* =========================================================
   Router wiring — handlers above are exported by name for direct
   invocation in targeted behavioral tests.
   ========================================================= */

router.get(
  "/signal-match-suggestions",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  listSignalMatchSuggestions
);

router.post(
  "/signal-match-suggestions/:id/accept",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  acceptSignalMatchSuggestion
);

router.post(
  "/signal-match-suggestions/:id/dismiss",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  dismissSignalMatchSuggestion
);

router.post(
  "/signal-match-suggestions/:id/recompute-score",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  recomputeSignalMatchSuggestionScore
);

export default router;
