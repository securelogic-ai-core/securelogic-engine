/**
 * riskApprovals.ts — Risk approval workflow (Epic R2).
 *
 * Executes the executive-approval gate scaffolded in R1. Endpoints (gated:
 * riskLifecycleFeatureFlag → requireApiKey → attachOrganizationContext →
 * requireEntitlement("premium") → asTenant):
 *   POST /api/risks/:id/approvals                       request approval (proposer)
 *   POST /api/risks/:id/approvals/:approvalId/decision  approve | reject (approver)
 *   GET  /api/approvals                                 org-wide pending-approvals queue
 *
 * Rules (spec §7 + Decisions Q1/Q2):
 *   - request & decision require a JWT user identity → 403 approval_requires_user
 *     for API-key-only callers (Q2).
 *   - decision authority is the designated approver (admin) via canApprove()
 *     → 403 approver_role_required (Q1a).
 *   - separation of duties: approver ≠ requester → 409 sod_violation (belt;
 *     the risk_approvals DB CHECK is suspenders).
 *   - every state change writes a risk_lifecycle_events row IN the same tenant
 *     transaction as the risks/approval UPDATEs. Because asTenant commits when
 *     the handler resolves, transitions are validated BEFORE any mutation.
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { requireNotViewer } from "../middleware/requireRole.js";
import { asTenant } from "../middleware/asTenant.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  sendApprovalRequestedNotification,
  sendApprovalDecidedNotification,
} from "../lib/riskLifecycleNotifier.js";
import { riskLifecycleFeatureFlag } from "../lib/riskLifecycleFeatureFlag.js";
import { canApprove } from "../lib/riskApprovalAuthority.js";
import {
  evaluateTransition,
  DEFAULT_LIFECYCLE_STATE,
  type GateInputs,
  type DecisionReason,
} from "../lib/riskLifecycleStateMachine.js";
import {
  isUuid,
  getOrgId,
  getUserId,
  getUserRole,
  getApiKeyId,
  loadGateRow,
  buildGateInputs,
} from "./riskLifecycle.js";

const router = Router();

const APPROVAL_KINDS = new Set(["treatment_plan", "risk_acceptance"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Map a rejected pure-machine decision to an HTTP response (shared with R1
 *  semantics: 422 invalid transition, 409 for gates/terminal/unknown-state). */
function sendTransitionError(res: Response, reason: DecisionReason | undefined, from: string, transition: string): void {
  if (reason === "invalid_transition") {
    res.status(422).json({ error: "invalid_transition", from, transition });
    return;
  }
  if (reason === "unknown_state") {
    res.status(409).json({ error: "invalid_lifecycle_state" });
    return;
  }
  if (reason === "terminal_state") {
    res.status(409).json({ error: "terminal_state", from });
    return;
  }
  res.status(409).json({ error: "gate_not_satisfied", reason });
}

// ── POST /api/risks/:id/approvals — request approval ────────────────────────
export async function requestRiskApproval(req: Request, res: Response): Promise<void> {
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
  // Q2: a request must be attributable to a human.
  const actorUserId = getUserId(req);
  if (!actorUserId) {
    res.status(403).json({ error: "approval_requires_user" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const kind = body.kind === undefined ? "treatment_plan" : body.kind;
  if (typeof kind !== "string" || !APPROVAL_KINDS.has(kind)) {
    res.status(400).json({ error: "invalid_kind" });
    return;
  }
  let treatmentId: string | null = null;
  if (body.treatment_id !== undefined && body.treatment_id !== null) {
    if (!isUuid(body.treatment_id)) {
      res.status(400).json({ error: "treatment_id_must_be_uuid" });
      return;
    }
    treatmentId = body.treatment_id;
  }
  let expiresAt: string | null = null;
  if (body.expires_at !== undefined && body.expires_at !== null) {
    if (typeof body.expires_at !== "string" || !DATE_RE.test(body.expires_at)) {
      res.status(400).json({ error: "invalid_expires_at", detail: "expires_at must be YYYY-MM-DD" });
      return;
    }
    expiresAt = body.expires_at;
  }
  const rationale =
    typeof body.request_rationale === "string" && body.request_rationale.trim().length > 0
      ? body.request_rationale.trim()
      : null;

  try {
    const riskRes = await pg.query(
      `SELECT lifecycle_state, owner_user_id, residual_rating, residual_score, title
         FROM risks WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [riskId, organizationId]
    );
    if ((riskRes.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "risk_not_found" });
      return;
    }
    const risk = riskRes.rows[0];
    const current: string = risk.lifecycle_state ?? DEFAULT_LIFECYCLE_STATE;

    // One open approval per risk (the risk row lock serialises concurrent requests).
    const openRes = await pg.query(
      `SELECT 1 FROM risk_approvals
         WHERE organization_id = $1 AND risk_id = $2 AND decision = 'pending' LIMIT 1`,
      [organizationId, riskId]
    );
    if ((openRes.rowCount ?? 0) > 0) {
      res.status(409).json({ error: "approval_already_open" });
      return;
    }

    if (treatmentId) {
      const t = await pg.query(
        `SELECT 1 FROM risk_treatments WHERE id = $1 AND risk_id = $2 AND organization_id = $3 LIMIT 1`,
        [treatmentId, riskId, organizationId]
      );
      if ((t.rowCount ?? 0) === 0) {
        res.status(400).json({ error: "invalid_treatment_id" });
        return;
      }
    }

    // Validate the submit_for_approval transition BEFORE mutating.
    const hasOwner = risk.owner_user_id !== null && risk.owner_user_id !== undefined;
    const hasScore = risk.residual_rating !== null && risk.residual_rating !== undefined;
    const residualScore =
      risk.residual_score === null || risk.residual_score === undefined ? null : Number(risk.residual_score);
    const gr = await loadGateRow(organizationId, riskId);
    const gates = buildGateInputs(gr, hasOwner, hasScore, residualScore, actorUserId);
    const decision = evaluateTransition(current, "submit_for_approval", gates);
    if (!decision.allowed) {
      sendTransitionError(res, decision.reason, current, "submit_for_approval");
      return;
    }

    // Mutate: create the approval, move the risk, write the event — one tx.
    let approvalRow;
    try {
      const ins = await pg.query(
        `INSERT INTO risk_approvals (
           organization_id, risk_id, treatment_id, kind, decision,
           requested_by_user_id, request_rationale, expires_at
         ) VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)
         RETURNING id, kind, decision, requested_by_user_id, expires_at, created_at`,
        [organizationId, riskId, treatmentId, kind, actorUserId, rationale, expiresAt]
      );
      approvalRow = ins.rows[0];
    } catch (e) {
      // Unique-violation on the one-open partial index → concurrent open request.
      if ((e as { code?: string }).code === "23505") {
        res.status(409).json({ error: "approval_already_open" });
        return;
      }
      throw e;
    }

    await pg.query(
      `UPDATE risks SET lifecycle_state = 'pending_approval', updated_at = NOW()
         WHERE id = $1 AND organization_id = $2`,
      [riskId, organizationId]
    );
    await pg.query(
      `INSERT INTO risk_lifecycle_events (
         organization_id, risk_id, from_state, to_state, transition,
         actor_user_id, actor_api_key_id, comment, approval_id
       ) VALUES ($1, $2, $3, 'pending_approval', 'submit_for_approval', $4, $5, $6, $7)`,
      [organizationId, riskId, current, actorUserId, getApiKeyId(req), rationale, approvalRow.id]
    );

    writeAuditEvent({
      organizationId,
      actorApiKeyId: getApiKeyId(req),
      actorUserId,
      eventType: "risk.approval.requested",
      resourceType: "risk_approval",
      resourceId: approvalRow.id as string,
      payload: { risk_id: riskId, kind, from: current },
      ipAddress: req.ip ?? null,
    });

    // Notify eligible approvers — fire-and-forget, OUTSIDE this transaction
    // (pgElevated + separate sender). A mail failure never affects the request.
    void sendApprovalRequestedNotification({
      organizationId,
      riskId,
      riskTitle: (risk.title as string) ?? "a risk",
      requesterName: null,
    }).catch(() => {});

    res.status(201).json({ approval: approvalRow, lifecycle_state: "pending_approval" });
  } catch (err) {
    logger.error({ err, riskId }, "request_risk_approval_failed");
    res.status(500).json({ error: "request_risk_approval_failed" });
  }
}

// ── POST /api/risks/:id/approvals/:approvalId/decision — approve | reject ────
export async function decideRiskApproval(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const riskId = req.params.id;
  const approvalId = req.params.approvalId;
  if (!isUuid(riskId)) {
    res.status(400).json({ error: "risk_id_must_be_uuid" });
    return;
  }
  if (!isUuid(approvalId)) {
    res.status(400).json({ error: "approval_id_must_be_uuid" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const decisionInput = body.decision;
  if (decisionInput !== "approved" && decisionInput !== "rejected") {
    res.status(400).json({ error: "invalid_decision", detail: "decision must be 'approved' or 'rejected'" });
    return;
  }
  const comment = body.comment;
  if (typeof comment !== "string" || comment.trim().length === 0) {
    res.status(400).json({ error: "comment_required" });
    return;
  }

  // Authority (Q2 JWT identity + Q1a approver role) — before any DB work.
  const actorUserId = getUserId(req);
  const actorRole = getUserRole(req);
  const authority = canApprove({ actorUserId, actorRole });
  if (!authority.allowed) {
    res.status(403).json({ error: authority.reason });
    return;
  }

  const transition = decisionInput === "approved" ? "approve" : "reject";

  try {
    const apRes = await pg.query(
      `SELECT id, decision, requested_by_user_id
         FROM risk_approvals
        WHERE id = $1 AND organization_id = $2 AND risk_id = $3 FOR UPDATE`,
      [approvalId, organizationId, riskId]
    );
    if ((apRes.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "approval_not_found" });
      return;
    }
    const approval = apRes.rows[0];
    if (approval.decision !== "pending") {
      res.status(409).json({ error: "approval_already_decided", decision: approval.decision });
      return;
    }
    // Separation of duties: the requester may not decide their own approval.
    if (approval.requested_by_user_id === actorUserId) {
      res.status(409).json({ error: "sod_violation" });
      return;
    }

    const riskRes = await pg.query(
      `SELECT lifecycle_state, title FROM risks WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [riskId, organizationId]
    );
    if ((riskRes.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "risk_not_found" });
      return;
    }
    const current: string = riskRes.rows[0].lifecycle_state ?? DEFAULT_LIFECYCLE_STATE;
    const riskTitle: string = (riskRes.rows[0].title as string) ?? "a risk";

    // Validate BEFORE mutating. approvalGranted reflects the pending decision.
    const gates: GateInputs = {
      hasOwner: false,
      hasScore: false,
      hasEvidence: false,
      evidenceGateEnforced: false,
      treatmentCount: 0,
      approvalGranted: decisionInput === "approved",
      approvalRequired: true,
      actorUserId,
      proposerUserId: approval.requested_by_user_id ?? null,
    };
    const machine = evaluateTransition(current, transition, gates);
    if (!machine.allowed) {
      sendTransitionError(res, machine.reason, current, transition);
      return;
    }
    const toState = machine.toState as string;

    // Mutate: record the decision, move the risk, write the event — one tx.
    await pg.query(
      `UPDATE risk_approvals
          SET decision = $1, approver_user_id = $2, decision_rationale = $3,
              decided_at = NOW(), updated_at = NOW()
        WHERE id = $4 AND organization_id = $5`,
      [decisionInput, actorUserId, comment.trim(), approvalId, organizationId]
    );
    await pg.query(
      `UPDATE risks SET lifecycle_state = $1, updated_at = NOW()
         WHERE id = $2 AND organization_id = $3`,
      [toState, riskId, organizationId]
    );
    await pg.query(
      `INSERT INTO risk_lifecycle_events (
         organization_id, risk_id, from_state, to_state, transition,
         actor_user_id, actor_api_key_id, comment, approval_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [organizationId, riskId, current, toState, transition, actorUserId, getApiKeyId(req), comment.trim(), approvalId]
    );

    writeAuditEvent({
      organizationId,
      actorApiKeyId: getApiKeyId(req),
      actorUserId,
      eventType: `risk.approval.${decisionInput}`,
      resourceType: "risk_approval",
      resourceId: approvalId,
      payload: { risk_id: riskId, from: current, to: toState },
      ipAddress: req.ip ?? null,
    });

    // Notify the proposer of the decision — fire-and-forget, OUTSIDE this
    // transaction (pgElevated + separate sender). Never affects the response.
    if (approval.requested_by_user_id) {
      void sendApprovalDecidedNotification({
        organizationId,
        riskId,
        riskTitle,
        proposerUserId: approval.requested_by_user_id as string,
        decision: decisionInput,
        comment: comment.trim(),
      }).catch(() => {});
    }

    res.status(200).json({
      approval: { id: approvalId, decision: decisionInput, approver_user_id: actorUserId },
      lifecycle_state: toState,
    });
  } catch (err) {
    logger.error({ err, riskId, approvalId }, "decide_risk_approval_failed");
    res.status(500).json({ error: "decide_risk_approval_failed" });
  }
}

// ── GET /api/approvals — org-wide pending-approvals queue ────────────────────
export async function listApprovals(req: Request, res: Response): Promise<void> {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const status = req.query.status === undefined ? "pending" : req.query.status;
  if (status !== "pending" && status !== "approved" && status !== "rejected") {
    res.status(400).json({ error: "invalid_status" });
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
  const actorUserId = getUserId(req);

  try {
    const rows = await pg.query(
      `SELECT a.id, a.risk_id, a.treatment_id, a.kind, a.decision,
              a.requested_by_user_id, a.approver_user_id, a.request_rationale,
              a.expires_at, a.created_at,
              r.title AS risk_title, r.domain AS risk_domain,
              r.residual_rating, r.residual_score, r.lifecycle_state
         FROM risk_approvals a
         JOIN risks r ON r.id = a.risk_id AND r.organization_id = a.organization_id
        WHERE a.organization_id = $1 AND a.decision = $2
        ORDER BY a.created_at DESC
        LIMIT $3`,
      [organizationId, status, limit]
    );
    const approvals = rows.rows.map((a: Record<string, unknown>) => ({
      ...a,
      is_self_proposed: actorUserId !== null && a.requested_by_user_id === actorUserId,
    }));
    res.status(200).json({ approvals });
  } catch (err) {
    logger.error({ err }, "list_approvals_failed");
    res.status(500).json({ error: "list_approvals_failed" });
  }
}

// ── Route wiring ────────────────────────────────────────────────────────────
const CHAIN = [
  riskLifecycleFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
] as const;

// Approval mutations require a non-viewer role (decision also enforces admin via
// canApprove; requireNotViewer no-ops for API-key auth, which the handlers then
// refuse with approval_requires_user). The queue read is open to viewers.
router.post("/risks/:id/approvals", ...CHAIN, requireNotViewer, asTenant(requestRiskApproval));
router.post("/risks/:id/approvals/:approvalId/decision", ...CHAIN, requireNotViewer, asTenant(decideRiskApproval));
router.get("/approvals", ...CHAIN, asTenant(listApprovals));

export default router;
