/**
 * aiUseApprovals.ts — the formal AI use decision (T2-D2).
 *
 * Records "this organisation approves / conditionally approves / rejects /
 * suspends this AI system's use, on these grounds, by this person, until this
 * date" — the artifact an AI-governance reviewer asks for, and the one thing
 * the two assessment workflows (governance_reviews, ai_governance_assessments)
 * deliberately are not. Table: db/migrations/20261039_ai_use_approvals.sql;
 * read its header — the append-only shape and the two departures from the
 * vendor-engagement decision model are ruled there, not here.
 *
 * Routes:
 *   POST /api/ai-systems/:id/use-approvals   — record a decision (append-only)
 *   GET  /api/ai-systems/:id/use-approvals   — full decision history, newest
 *                                              first; the first row IS the
 *                                              current decision
 *
 * There is no PATCH and no DELETE, and the table grants neither: a wrong
 * decision is superseded by a new row, which is what makes the history an
 * audit artifact rather than a mutable field with amnesia.
 *
 * THE DECISION SNAPSHOTS WHAT IT WAS MADE AGAINST:
 *   - material_state_version is read from the ai_systems row inside the same
 *     tenant transaction, so "approved, but the system has materially changed
 *     since" is computable forever as (system.version > approval.version);
 *   - assessment_id (optional) pins the ai_governance_assessments row that
 *     informed the decision, pre-flighted same-org AND same-system — an
 *     assessment of a different system justifying this one would be a
 *     provenance lie the read path could never detect.
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
import { AI_USE_APPROVAL_DECISIONS } from "../lib/aiSystemValidation.js";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function getOrgId(req: Request): string | null {
  return (req as any).organizationContext?.organizationId ?? null;
}

const APPROVAL_SELECT = `
  id,
  organization_id,
  ai_system_id,
  decision,
  rationale,
  conditions,
  decided_by_user_id,
  decided_at,
  expires_at,
  assessment_id,
  material_state_version,
  created_at
`;

export async function recordAiUseApproval(req: Request, res: Response): Promise<void> {
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

  const body = (req.body ?? {}) as Record<string, unknown>;

  const decision = body["decision"];
  if (typeof decision !== "string" || !AI_USE_APPROVAL_DECISIONS.has(decision)) {
    res.status(400).json({ error: "invalid_decision", allowed: [...AI_USE_APPROVAL_DECISIONS] });
    return;
  }

  // A decision with no grounds is unauditable in every direction — the DB
  // enforces this too (rationale_nonblank); validating here turns a 23514
  // into an actionable 400.
  const rationale = body["rationale"];
  if (typeof rationale !== "string" || rationale.trim().length === 0) {
    res.status(400).json({
      error: "rationale_required",
      detail: "Every use decision — approval, rejection or suspension — must state its grounds."
    });
    return;
  }

  const conditions = body["conditions"];
  if (decision === "approved_with_conditions") {
    if (typeof conditions !== "string" || conditions.trim().length === 0) {
      res.status(400).json({
        error: "conditions_required",
        detail: "approved_with_conditions must state the conditions."
      });
      return;
    }
  } else if (conditions != null) {
    res.status(400).json({ error: "conditions_only_on_conditional_approval" });
    return;
  }

  const expiresAt = body["expires_at"];
  if (expiresAt != null) {
    if (typeof expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
      res.status(400).json({ error: "expires_at_must_be_iso_date" });
      return;
    }
    if (decision !== "approved" && decision !== "approved_with_conditions") {
      // Mirrors the DB CHECK: a rejection or suspension stands until
      // superseded; only an approval expires.
      res.status(400).json({ error: "expiry_only_on_approval" });
      return;
    }
  }

  const assessmentId = body["assessment_id"];
  if (assessmentId != null && !isUuid(assessmentId)) {
    res.status(400).json({ error: "assessment_id_must_be_uuid" });
    return;
  }

  try {
    // The system, and the material-state version this decision is made
    // against, in one org-scoped read inside the tenant transaction.
    const systemRow = await pg.query<{ material_state_version: number }>(
      `SELECT material_state_version FROM ai_systems
        WHERE id = $1 AND organization_id = $2`,
      [aiSystemId, organizationId]
    );
    if ((systemRow.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "ai_system_not_found" });
      return;
    }
    const materialStateVersion = systemRow.rows[0]!.material_state_version;

    if (assessmentId != null) {
      // Same-org AND same-system: an assessment of another system cannot
      // justify this one (see header).
      const assessCheck = await pg.query(
        `SELECT 1 FROM ai_governance_assessments
          WHERE id = $1 AND organization_id = $2 AND ai_system_id = $3
          LIMIT 1`,
        [assessmentId, organizationId, aiSystemId]
      );
      if ((assessCheck.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "assessment_not_found_for_this_system" });
        return;
      }
    }

    const inserted = await pg.query(
      `INSERT INTO ai_use_approvals
         (organization_id, ai_system_id, decision, rationale, conditions,
          decided_by_user_id, expires_at, assessment_id, material_state_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${APPROVAL_SELECT}`,
      [
        organizationId,
        aiSystemId,
        decision,
        rationale.trim(),
        decision === "approved_with_conditions" ? (conditions as string).trim() : null,
        req.userId ?? null,
        expiresAt ?? null,
        assessmentId ?? null,
        materialStateVersion
      ]
    );

    const approval = inserted.rows[0];
    writeAuditEvent({
      organizationId,
      actorApiKeyId: (req as any).apiKey?.id ?? null,
      actorUserId: req.userId ?? null,
      eventType: "ai_system.use_decision_recorded",
      resourceType: "ai_system",
      resourceId: aiSystemId,
      payload: {
        approval_id: approval.id,
        decision,
        expires_at: expiresAt ?? null,
        assessment_id: assessmentId ?? null,
        material_state_version: materialStateVersion
      },
      ipAddress: req.ip ?? null
    });

    res.status(201).json({ approval });
  } catch (err) {
    logger.error(
      { event: "ai_use_approval_record_failed", err },
      "POST /api/ai-systems/:id/use-approvals failed"
    );
    res.status(500).json({ error: "ai_use_approval_record_failed" });
  }
}

export async function listAiUseApprovals(req: Request, res: Response): Promise<void> {
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
    // Existence pre-flight: an empty history is "never decided", not "no such
    // system" — different facts, different responses.
    const aiCheck = await pg.query(
      `SELECT 1, material_state_version FROM ai_systems
        WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [aiSystemId, organizationId]
    );
    if ((aiCheck.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "ai_system_not_found" });
      return;
    }
    const currentVersion = (aiCheck.rows[0] as { material_state_version: number })
      .material_state_version;

    const result = await pg.query(
      `SELECT ${APPROVAL_SELECT}
         FROM ai_use_approvals
        WHERE ai_system_id = $1 AND organization_id = $2
        ORDER BY decided_at DESC, id DESC`,
      [aiSystemId, organizationId]
    );

    const rows = result.rows as Array<{ material_state_version: number; expires_at: string | null }>;
    const current = rows[0] ?? null;

    res.status(200).json({
      count: rows.length,
      // The current decision, with the two staleness facts the caller would
      // otherwise recompute wrongly: has the system materially changed since,
      // and has the approval expired. Both computed here, once.
      current_decision: current
        ? {
            ...current,
            materially_changed_since:
              currentVersion > current.material_state_version,
            expired:
              current.expires_at != null &&
              current.expires_at < new Date().toISOString().slice(0, 10)
          }
        : null,
      approvals: rows
    });
  } catch (err) {
    logger.error(
      { event: "ai_use_approvals_list_failed", err },
      "GET /api/ai-systems/:id/use-approvals failed"
    );
    res.status(500).json({ error: "ai_use_approvals_list_failed" });
  }
}

router.post(
  "/ai-systems/:id/use-approvals",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(recordAiUseApproval)
);

router.get(
  "/ai-systems/:id/use-approvals",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(listAiUseApprovals)
);

export default router;
