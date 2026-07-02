/**
 * riskLifecycle.ts — Risk lifecycle transition API (Epic R1).
 *
 * Endpoints (all gated: riskLifecycleFeatureFlag → requireApiKey →
 * attachOrganizationContext → requireEntitlement("premium") → asTenant):
 *   GET  /api/risks/:id/lifecycle              current state + gates + allowed transitions
 *   POST /api/risks/:id/lifecycle/transitions  execute a transition (atomic)
 *   GET  /api/risks/:id/lifecycle/events       append-only event stream
 *
 * The transition handler runs entirely inside the tenant transaction opened by
 * asTenant/withTenant: it locks the risk row FOR UPDATE, resolves gate inputs,
 * runs the pure state machine, UPDATEs risks.lifecycle_state, and INSERTs the
 * risk_lifecycle_events row — all committed together (atomicity is the point;
 * spec §7.2). A best-effort security_audit_log mirror is fired separately.
 *
 * Authority: docs/specs/risk-lifecycle-spec.md §5/§7 + "Decisions (R1)".
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { asTenant } from "../middleware/asTenant.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { riskLifecycleFeatureFlag } from "../lib/riskLifecycleFeatureFlag.js";
import {
  evaluateTransition,
  legacyStatusForTransition,
  DEFAULT_LIFECYCLE_STATE,
  TRANSITIONS,
  type TransitionName,
  type GateInputs,
} from "../lib/riskLifecycleStateMachine.js";

const router = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export function getOrgId(req: Request): string | null {
  const ctx = (req as unknown as {
    organizationContext?: { organizationId?: string };
  }).organizationContext;
  return ctx?.organizationId ?? null;
}

export function getApiKeyId(req: Request): string | null {
  return (req as unknown as { apiKey?: { id?: string } }).apiKey?.id ?? null;
}

export function getUserId(req: Request): string | null {
  return (req as unknown as { userId?: string }).userId ?? null;
}

export function getUserRole(req: Request): string | null {
  return (req as unknown as { userRole?: string }).userRole ?? null;
}

const TRANSITION_SET = new Set<string>(TRANSITIONS);

/**
 * Transitions owned exclusively by the approvals sub-workflow — POST
 * /api/risks/:id/approvals (request) and .../:approvalId/decision (approve|reject).
 * Those endpoints enforce the single approver-authority seam (`canApprove`),
 * separation of duties, and decision recording. They are REFUSED on this generic
 * transition endpoint so the executive-approval gate cannot be crossed outside
 * that seam.
 *
 * Why this matters (SoD core, Epic R2): the pure state machine's `reject` edge
 * requires only actor-identity + SoD, and its `approve` edge's `approval_required`
 * gate is satisfied by *any* prior approved approval on the risk. So without this
 * guard a non-approver could reject an approval (from cycle 1), or — on a
 * re-opened risk carrying a stale approved row — approve one, both bypassing
 * `canApprove`. Routing all three through the approvals endpoints closes that.
 */
const APPROVAL_MANAGED_TRANSITIONS = new Set<string>([
  "submit_for_approval",
  "approve",
  "reject",
]);

export interface GateRow {
  treatment_count: number;
  has_evidence: boolean;
  approval_granted: boolean;
  proposer_user_id: string | null;
  approval_threshold_score: number | null;
  require_evidence_gate: boolean;
}

/** One round-trip that resolves every gate input for a risk (no Promise.all —
 *  single query keeps us off concurrent queries on the tenant client). */
export async function loadGateRow(orgId: string, riskId: string): Promise<GateRow> {
  const q = await pg.query(
    `SELECT
       (SELECT count(*) FROM risk_treatments t
          WHERE t.organization_id = $1 AND t.risk_id = $2)::int          AS treatment_count,
       EXISTS(
         SELECT 1 FROM evidence e
         JOIN risk_treatments t
           ON t.id = e.source_id AND e.source_type = 'risk_treatment'
         WHERE t.organization_id = $1 AND t.risk_id = $2
           AND e.organization_id = $1
       )                                                                  AS has_evidence,
       EXISTS(
         SELECT 1 FROM risk_approvals a
         WHERE a.organization_id = $1 AND a.risk_id = $2 AND a.decision = 'approved'
       )                                                                  AS approval_granted,
       (SELECT a.requested_by_user_id FROM risk_approvals a
          WHERE a.organization_id = $1 AND a.risk_id = $2 AND a.decision = 'pending'
          LIMIT 1)                                                        AS proposer_user_id,
       (SELECT s.approval_threshold_score FROM risk_settings s
          WHERE s.organization_id = $1)                                   AS approval_threshold_score,
       COALESCE((SELECT s.require_evidence_gate FROM risk_settings s
          WHERE s.organization_id = $1), false)                          AS require_evidence_gate`,
    [orgId, riskId]
  );
  const r = q.rows[0] ?? {};
  return {
    treatment_count: Number(r.treatment_count ?? 0),
    has_evidence: r.has_evidence === true,
    approval_granted: r.approval_granted === true,
    proposer_user_id: r.proposer_user_id ?? null,
    approval_threshold_score:
      r.approval_threshold_score === null || r.approval_threshold_score === undefined
        ? null
        : Number(r.approval_threshold_score),
    require_evidence_gate: r.require_evidence_gate === true,
  };
}

/** Whether approval is required for this risk under the threshold model.
 *  NULL threshold ⇒ always required (designated-approver model, R1 default). */
export function computeApprovalRequired(
  threshold: number | null,
  residualScore: number | null
): boolean {
  if (threshold === null) return true;
  if (residualScore === null) return true; // unscored ⇒ be conservative, require approval
  return residualScore >= threshold;
}

export function buildGateInputs(
  gr: GateRow,
  hasOwner: boolean,
  hasScore: boolean,
  residualScore: number | null,
  actorUserId: string | null
): GateInputs {
  return {
    hasOwner,
    hasScore,
    hasEvidence: gr.has_evidence,
    evidenceGateEnforced: gr.require_evidence_gate,
    treatmentCount: gr.treatment_count,
    approvalGranted: gr.approval_granted,
    approvalRequired: computeApprovalRequired(gr.approval_threshold_score, residualScore),
    actorUserId,
    proposerUserId: gr.proposer_user_id,
  };
}

// ── GET /api/risks/:id/lifecycle ────────────────────────────────────────────
export async function getRiskLifecycle(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const riskId = req.params.id;
  if (!isUuid(riskId)) {
    res.status(400).json({ error: "risk_id_must_be_uuid" });
    return;
  }
  try {
    const riskRes = await pg.query(
      `SELECT lifecycle_state, owner_user_id, residual_rating, residual_score
         FROM risks WHERE id = $1 AND organization_id = $2`,
      [riskId, organizationId]
    );
    if ((riskRes.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "risk_not_found" });
      return;
    }
    const risk = riskRes.rows[0];
    const current: string = risk.lifecycle_state ?? DEFAULT_LIFECYCLE_STATE;
    const hasOwner = risk.owner_user_id !== null && risk.owner_user_id !== undefined;
    const hasScore = risk.residual_rating !== null && risk.residual_rating !== undefined;
    const residualScore =
      risk.residual_score === null || risk.residual_score === undefined
        ? null
        : Number(risk.residual_score);

    const gr = await loadGateRow(organizationId, riskId);
    const gates = buildGateInputs(gr, hasOwner, hasScore, residualScore, getUserId(req));

    // allowed_transitions describes what THIS (generic) endpoint will accept, so
    // the approval-managed transitions are excluded — R3 drives those from the
    // `gates` block via the approvals endpoints. Keeps GET and POST consistent.
    const allowed: string[] = [];
    for (const t of TRANSITIONS) {
      if (APPROVAL_MANAGED_TRANSITIONS.has(t)) continue;
      if (evaluateTransition(current, t, gates).allowed) allowed.push(t);
    }

    res.status(200).json({
      lifecycle_state: current,
      gates: {
        owner: hasOwner,
        score: hasScore,
        evidence: gr.has_evidence,
        evidence_gate_enforced: gr.require_evidence_gate,
        treatment_count: gr.treatment_count,
        approval_granted: gr.approval_granted,
        approval_required: gates.approvalRequired,
      },
      allowed_transitions: allowed,
    });
  } catch (err) {
    logger.error({ err, riskId }, "get_risk_lifecycle_failed");
    res.status(500).json({ error: "get_risk_lifecycle_failed" });
  }
}

// ── POST /api/risks/:id/lifecycle/transitions ───────────────────────────────
export async function executeRiskTransition(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const riskId = req.params.id;
  if (!isUuid(riskId)) {
    res.status(400).json({ error: "risk_id_must_be_uuid" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const transition = body.transition;
  if (typeof transition !== "string" || !TRANSITION_SET.has(transition)) {
    res.status(400).json({ error: "invalid_transition_name" });
    return;
  }
  // Approval transitions must flow through the approvals endpoints (the single
  // canApprove authority seam) — refuse them here so SoD/authority cannot be
  // bypassed via the generic transition endpoint.
  if (APPROVAL_MANAGED_TRANSITIONS.has(transition)) {
    res.status(409).json({
      error: "use_approvals_endpoint",
      transition,
      detail:
        "approval transitions are handled by POST /api/risks/:id/approvals and " +
        "POST /api/risks/:id/approvals/:approvalId/decision",
    });
    return;
  }
  const comment = body.comment;
  if (typeof comment !== "string" || comment.trim().length === 0) {
    res.status(400).json({ error: "comment_required" });
    return;
  }
  const expectedFrom = body.expected_from_state;
  if (expectedFrom !== undefined && typeof expectedFrom !== "string") {
    res.status(400).json({ error: "invalid_expected_from_state" });
    return;
  }
  let evidenceIds: string[] = [];
  if (body.evidence_ids !== undefined) {
    if (!Array.isArray(body.evidence_ids) || !body.evidence_ids.every(isUuid)) {
      res.status(400).json({ error: "evidence_ids_must_be_uuids" });
      return;
    }
    evidenceIds = body.evidence_ids as string[];
  }

  try {
    // Lock the risk row for the duration of the transition.
    const riskRes = await pg.query(
      `SELECT lifecycle_state, owner_user_id, residual_rating, residual_score
         FROM risks WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [riskId, organizationId]
    );
    if ((riskRes.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "risk_not_found" });
      return;
    }
    const risk = riskRes.rows[0];
    const current: string = risk.lifecycle_state ?? DEFAULT_LIFECYCLE_STATE;

    // Optimistic concurrency: caller may pin the expected current state.
    if (expectedFrom !== undefined && expectedFrom !== current) {
      res.status(409).json({
        error: "state_conflict",
        expected: expectedFrom,
        actual: current,
      });
      return;
    }

    const hasOwner = risk.owner_user_id !== null && risk.owner_user_id !== undefined;
    const hasScore = risk.residual_rating !== null && risk.residual_rating !== undefined;
    const residualScore =
      risk.residual_score === null || risk.residual_score === undefined
        ? null
        : Number(risk.residual_score);

    const gr = await loadGateRow(organizationId, riskId);
    const gates = buildGateInputs(gr, hasOwner, hasScore, residualScore, getUserId(req));

    const decision = evaluateTransition(current, transition, gates);
    if (!decision.allowed) {
      const reason = decision.reason;
      if (reason === "invalid_transition") {
        res.status(422).json({ error: "invalid_transition", from: current, transition });
        return;
      }
      if (reason === "unknown_state") {
        res.status(409).json({ error: "invalid_lifecycle_state" });
        return;
      }
      if (reason === "terminal_state") {
        res.status(409).json({ error: "terminal_state", from: current });
        return;
      }
      // gate reasons
      res.status(409).json({ error: "gate_not_satisfied", reason });
      return;
    }

    const toState = decision.toState as string;
    const legacyStatus = legacyStatusForTransition(transition as TransitionName);

    if (legacyStatus !== null) {
      await pg.query(
        `UPDATE risks SET lifecycle_state = $1, status = $2, updated_at = NOW()
           WHERE id = $3 AND organization_id = $4`,
        [toState, legacyStatus, riskId, organizationId]
      );
    } else {
      await pg.query(
        `UPDATE risks SET lifecycle_state = $1, updated_at = NOW()
           WHERE id = $2 AND organization_id = $3`,
        [toState, riskId, organizationId]
      );
    }

    // Event row — SAME tenant transaction as the UPDATE (atomic).
    const actorUserId = getUserId(req);
    const eventRes = await pg.query(
      `INSERT INTO risk_lifecycle_events (
         organization_id, risk_id, from_state, to_state, transition,
         actor_user_id, actor_api_key_id, comment, evidence_ids
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, created_at`,
      [
        organizationId,
        riskId,
        current,
        toState,
        transition,
        actorUserId,
        getApiKeyId(req),
        comment.trim(),
        evidenceIds,
      ]
    );
    const event = eventRes.rows[0];

    // Best-effort mirror to the global audit feed (separate pool; not in-tx).
    writeAuditEvent({
      organizationId,
      actorApiKeyId: getApiKeyId(req),
      actorUserId,
      eventType: `risk.lifecycle.${transition}`,
      resourceType: "risk",
      resourceId: riskId,
      payload: { from: current, to: toState, event_id: event?.id ?? null },
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({
      lifecycle_state: toState,
      event: {
        id: event?.id ?? null,
        from_state: current,
        to_state: toState,
        transition,
        created_at: event?.created_at ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, riskId, transition }, "risk_lifecycle_transition_failed");
    res.status(500).json({ error: "risk_lifecycle_transition_failed" });
  }
}

// ── GET /api/risks/:id/lifecycle/events ─────────────────────────────────────
export async function getRiskLifecycleEvents(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const riskId = req.params.id;
  if (!isUuid(riskId)) {
    res.status(400).json({ error: "risk_id_must_be_uuid" });
    return;
  }

  let limit = 50;
  if (req.query.limit !== undefined) {
    const n = Number(req.query.limit);
    if (!Number.isInteger(n) || n < 1 || n > 200) {
      res.status(400).json({ error: "invalid_limit", detail: "limit must be 1–200" });
      return;
    }
    limit = n;
  }
  const before = typeof req.query.before === "string" ? req.query.before : null;

  try {
    const exists = await pg.query(
      `SELECT 1 FROM risks WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [riskId, organizationId]
    );
    if ((exists.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "risk_not_found" });
      return;
    }

    const params: unknown[] = [organizationId, riskId];
    let beforeClause = "";
    if (before) {
      params.push(before);
      beforeClause = `AND created_at < $${params.length}`;
    }
    params.push(limit);
    const rows = await pg.query(
      `SELECT id, from_state, to_state, transition, actor_user_id,
              actor_api_key_id, comment, evidence_ids, approval_id, created_at
         FROM risk_lifecycle_events
        WHERE organization_id = $1 AND risk_id = $2 ${beforeClause}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length}`,
      params
    );
    const events = rows.rows;
    const nextCursor =
      events.length === limit ? events[events.length - 1]?.created_at ?? null : null;

    res.status(200).json({ events, next_cursor: nextCursor });
  } catch (err) {
    logger.error({ err, riskId }, "get_risk_lifecycle_events_failed");
    res.status(500).json({ error: "get_risk_lifecycle_events_failed" });
  }
}

// ── Route wiring ────────────────────────────────────────────────────────────
const CHAIN = [
  riskLifecycleFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
] as const;

router.get("/risks/:id/lifecycle", ...CHAIN, asTenant(getRiskLifecycle));
router.post("/risks/:id/lifecycle/transitions", ...CHAIN, asTenant(executeRiskTransition));
router.get("/risks/:id/lifecycle/events", ...CHAIN, asTenant(getRiskLifecycleEvents));

export default router;
