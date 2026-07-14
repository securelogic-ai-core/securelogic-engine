/**
 * riskAcceptances.ts — the Finding risk-acceptance API (product ruling 2026-07-12).
 *
 *   POST  /api/findings/:id/risk-acceptance      propose (owner, rationale, expiry)
 *   POST  /api/risk-acceptances/:id/approve      approve — CLOSES the finding
 *   POST  /api/risk-acceptances/:id/reject       reject  — finding stays / returns active
 *   POST  /api/risk-acceptances/:id/withdraw     withdraw — REOPENS the finding
 *   GET   /api/risk-acceptances                  the accepted-risk register
 *   GET   /api/risk-acceptances/summary          review / expiry / governance queues
 *
 * Findings are OPERATIONAL WORK; the Enterprise Risk Register is ENDURING BUSINESS RISK.
 * They stay separate concepts. Accepting a risk closes the operational Finding and moves
 * the exposure into a durable, append-only governance record — it does NOT delete the
 * exposure, and it does NOT (yet) create a Risk. `promoted_risk_id` is the forward hook
 * for that promotion; nothing in this file writes it.
 *
 * Every route is flag-gated (SECURELOGIC_RISK_ACCEPTANCE_ENABLED) and 404s while off, so
 * production keeps its current behaviour until the flag is deliberately flipped.
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { asTenant } from "../middleware/asTenant.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { riskAcceptanceFeatureFlag } from "../lib/riskAcceptanceFeatureFlag.js";
import {
  ACCEPTANCE_SELECT,
  acceptanceSelect,
  reopenFindingAfterAcceptanceEnded,
  type RiskAcceptance,
} from "../lib/riskAcceptance.js";
import {
  recomputeFindingOperationalStatus,
  writeFindingLifecycleEvent,
  type LifecycleActor,
} from "../lib/findingLifecycle.js";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RATIONALE = 4000;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

const orgOf = (req: unknown): string | null =>
  ((req as { organizationContext?: { organizationId?: string } }).organizationContext
    ?.organizationId) ?? null;

const actorOf = (req: { userId?: unknown; apiKey?: { id?: string } }): LifecycleActor => ({
  actorUserId: (req.userId as string | undefined) ?? null,
  actorApiKeyId: req.apiKey?.id ?? null,
});

/* =========================================================
   POST /api/findings/:id/risk-acceptance — PROPOSE
   =========================================================
   A proposal is NOT an approval. This creates the durable record and leaves the finding
   fully ACTIVE: it is still live work until governance signs it off. decision_state is
   deliberately NOT set here — per the ruling, accepted_risk + closed are set together,
   at approval, once the decision actually exists.
   ========================================================= */

router.post(
  "/findings/:id/risk-acceptance",
  riskAcceptanceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    try {
      const organizationId = orgOf(req);
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const findingId = req.params.id;
      if (!isUuid(findingId)) {
        res.status(400).json({ error: "invalid_finding_id" });
        return;
      }

      // The requester must be a SESSION identity. An API key has no user, and an
      // acceptance with no requester cannot satisfy separation of duties — there would
      // be nobody for the approver to be different FROM.
      const requestedBy = (req.userId as string | undefined) ?? null;
      if (!requestedBy) {
        res.status(403).json({ error: "user_identity_required" });
        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const ownerUserId = body["owner_user_id"];
      const rationale = body["rationale"];
      const expiresAt = body["expires_at"];

      if (!isUuid(ownerUserId)) {
        res.status(400).json({ error: "owner_user_id_required" });
        return;
      }
      if (!isNonEmptyString(rationale) || rationale.trim().length > MAX_RATIONALE) {
        res.status(400).json({ error: "rationale_required" });
        return;
      }
      // An acceptance with no expiry is a permanent pardon. The whole point of the
      // object is that accepted risk comes back for review.
      if (!isNonEmptyString(expiresAt) || !ISO_DATE_RE.test(expiresAt.trim())) {
        res.status(400).json({ error: "expires_at_required", detail: "YYYY-MM-DD" });
        return;
      }

      const finding = await pg.query<{ id: string }>(
        `SELECT id FROM findings WHERE id = $1 AND organization_id = $2`,
        [findingId, organizationId]
      );
      if ((finding.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "finding_not_found" });
        return;
      }

      // The owner must belong to THIS org. Without this check an acceptance could name a
      // user from another tenant as the accountable owner.
      const owner = await pg.query<{ id: string }>(
        `SELECT id FROM users WHERE id = $1 AND organization_id = $2`,
        [ownerUserId, organizationId]
      );
      if ((owner.rowCount ?? 0) === 0) {
        res.status(400).json({ error: "owner_not_in_organization" });
        return;
      }

      let created;
      try {
        created = await pg.query<RiskAcceptance>(
          `INSERT INTO finding_risk_acceptances
             (organization_id, finding_id, state, owner_user_id, rationale,
              requested_by_user_id, expires_at)
           VALUES ($1, $2, 'proposed', $3, $4, $5, $6::date)
           RETURNING ${ACCEPTANCE_SELECT}`,
          [organizationId, findingId, ownerUserId, rationale.trim(), requestedBy, expiresAt.trim()]
        );
      } catch (err: unknown) {
        // The partial unique index: at most one live acceptance per finding.
        if ((err as { code?: string })?.code === "23505") {
          res.status(409).json({ error: "acceptance_already_live_for_finding" });
          return;
        }
        throw err;
      }

      const acceptance = created.rows[0]!;

      writeAuditEvent({
        organizationId,
        actorUserId: requestedBy,
        actorApiKeyId: (req as { apiKey?: { id?: string } }).apiKey?.id ?? null,
        eventType: "finding.risk_acceptance.proposed",
        resourceType: "finding_risk_acceptance",
        resourceId: acceptance.id,
        payload: { finding_id: findingId, owner_user_id: ownerUserId, expires_at: acceptance.expires_at },
        ipAddress: req.ip ?? null,
      });

      res.status(201).json({ acceptance });
    } catch (err) {
      logger.error({ event: "risk_acceptance_propose_failed", err }, "POST risk-acceptance failed");
      res.status(500).json({ error: "risk_acceptance_propose_failed" });
    }
  })
);

/* =========================================================
   POST /api/risk-acceptances/:id/approve — the decision that CLOSES the finding
   ========================================================= */

router.post(
  "/risk-acceptances/:id/approve",
  riskAcceptanceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    try {
      const organizationId = orgOf(req);
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }
      const acceptanceId = req.params.id;
      if (!isUuid(acceptanceId)) {
        res.status(400).json({ error: "invalid_acceptance_id" });
        return;
      }

      const approver = (req.userId as string | undefined) ?? null;
      if (!approver) {
        res.status(403).json({ error: "user_identity_required" });
        return;
      }

      const decisionRationale = (req.body ?? {})["decision_rationale"];

      const existing = await pg.query<{
        id: string; finding_id: string; state: string; requested_by_user_id: string | null;
      }>(
        `SELECT id, finding_id, state, requested_by_user_id
           FROM finding_risk_acceptances
          WHERE id = $1 AND organization_id = $2
          FOR UPDATE`,
        [acceptanceId, organizationId]
      );
      const row = existing.rows[0];
      if (!row) {
        res.status(404).json({ error: "acceptance_not_found" });
        return;
      }
      if (row.state !== "proposed" && row.state !== "legacy_unverified") {
        res.status(409).json({ error: "acceptance_not_approvable", state: row.state });
        return;
      }

      // Separation of duties. Also a DB CHECK — this is the friendly 403, not the guard.
      if (row.requested_by_user_id !== null && row.requested_by_user_id === approver) {
        res.status(403).json({ error: "separation_of_duties" });
        return;
      }

      // A legacy_unverified record has no rationale/owner/expiry and the DB will refuse
      // to let it become 'approved' without them. Completing a legacy acceptance is a
      // governance act that must supply the missing evidence — a separate flow, not a
      // rubber stamp. Refuse it here with a message that says so.
      if (row.state === "legacy_unverified") {
        res.status(409).json({
          error: "legacy_acceptance_requires_completion",
          detail:
            "This is a historical acceptance with no approval evidence. Withdraw it (which reopens the finding) and propose a new acceptance with owner, rationale and expiry.",
        });
        return;
      }

      const updated = await pg.query<RiskAcceptance>(
        `UPDATE finding_risk_acceptances
            SET state = 'approved',
                approver_user_id = $3,
                approved_at = NOW(),
                decision_rationale = $4
          WHERE id = $1 AND organization_id = $2
          RETURNING ${ACCEPTANCE_SELECT}`,
        [
          acceptanceId,
          organizationId,
          approver,
          isNonEmptyString(decisionRationale) ? decisionRationale.trim().slice(0, MAX_RATIONALE) : null,
        ]
      );
      const acceptance = updated.rows[0]!;

      const actor = actorOf(req as never);

      // Ruling step 4: decision_state and operational_status are set TOGETHER, now that
      // the approval exists. decision_state is written here; operational_status is NEVER
      // hand-set — the recompute derives it, and the now-binding acceptance closes it.
      const findingBefore = await pg.query<{ decision_state: string | null }>(
        `SELECT decision_state FROM findings WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [acceptance.finding_id, organizationId]
      );
      const fromDecision = findingBefore.rows[0]?.decision_state ?? "needs_review";

      if (fromDecision !== "accepted_risk") {
        await pg.query(
          `UPDATE findings SET decision_state = 'accepted_risk', updated_at = NOW()
            WHERE id = $1 AND organization_id = $2`,
          [acceptance.finding_id, organizationId]
        );
        await writeFindingLifecycleEvent({
          organizationId,
          findingId: acceptance.finding_id,
          axis: "decision",
          fromState: fromDecision,
          toState: "accepted_risk",
          transition: "accept_risk",
          actor,
        });
      }

      const recompute = await recomputeFindingOperationalStatus(
        organizationId,
        acceptance.finding_id,
        actor
      );

      writeAuditEvent({
        organizationId,
        actorUserId: approver,
        actorApiKeyId: (req as { apiKey?: { id?: string } }).apiKey?.id ?? null,
        eventType: "finding.risk_acceptance.approved",
        resourceType: "finding_risk_acceptance",
        resourceId: acceptance.id,
        payload: {
          finding_id: acceptance.finding_id,
          expires_at: acceptance.expires_at,
          finding_closed: recompute.toState === "closed",
        },
        ipAddress: req.ip ?? null,
      });

      res.json({ acceptance, finding_operational_status: recompute.toState ?? "unchanged" });
    } catch (err) {
      logger.error({ event: "risk_acceptance_approve_failed", err }, "approve failed");
      res.status(500).json({ error: "risk_acceptance_approve_failed" });
    }
  })
);

/* =========================================================
   POST /api/risk-acceptances/:id/reject
   =========================================================
   Rejecting a PROPOSAL changes nothing operationally — the finding was never closed by
   it. The reopen call is still made (it is a no-op for an open finding) so that the one
   path out of acceptance is the one path, and a rejection can never leave a finding
   stranded in closure.
   ========================================================= */

router.post(
  "/risk-acceptances/:id/reject",
  riskAcceptanceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    try {
      const organizationId = orgOf(req);
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }
      const acceptanceId = req.params.id;
      if (!isUuid(acceptanceId)) {
        res.status(400).json({ error: "invalid_acceptance_id" });
        return;
      }
      const approver = (req.userId as string | undefined) ?? null;
      if (!approver) {
        res.status(403).json({ error: "user_identity_required" });
        return;
      }

      const existing = await pg.query<{ finding_id: string; state: string; requested_by_user_id: string | null }>(
        `SELECT finding_id, state, requested_by_user_id FROM finding_risk_acceptances
          WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [acceptanceId, organizationId]
      );
      const row = existing.rows[0];
      if (!row) {
        res.status(404).json({ error: "acceptance_not_found" });
        return;
      }
      if (row.state !== "proposed") {
        res.status(409).json({ error: "acceptance_not_rejectable", state: row.state });
        return;
      }
      if (row.requested_by_user_id !== null && row.requested_by_user_id === approver) {
        res.status(403).json({ error: "separation_of_duties" });
        return;
      }

      const decisionRationale = (req.body ?? {})["decision_rationale"];

      const updated = await pg.query<RiskAcceptance>(
        `UPDATE finding_risk_acceptances
            SET state = 'rejected', approver_user_id = $3, decision_rationale = $4
          WHERE id = $1 AND organization_id = $2
          RETURNING ${ACCEPTANCE_SELECT}`,
        [
          acceptanceId,
          organizationId,
          approver,
          isNonEmptyString(decisionRationale) ? decisionRationale.trim().slice(0, MAX_RATIONALE) : null,
        ]
      );

      const actor = actorOf(req as never);
      await reopenFindingAfterAcceptanceEnded(organizationId, row.finding_id, actor, "rejected");

      writeAuditEvent({
        organizationId,
        actorUserId: approver,
        actorApiKeyId: (req as { apiKey?: { id?: string } }).apiKey?.id ?? null,
        eventType: "finding.risk_acceptance.rejected",
        resourceType: "finding_risk_acceptance",
        resourceId: acceptanceId,
        payload: { finding_id: row.finding_id },
        ipAddress: req.ip ?? null,
      });

      res.json({ acceptance: updated.rows[0] });
    } catch (err) {
      logger.error({ event: "risk_acceptance_reject_failed", err }, "reject failed");
      res.status(500).json({ error: "risk_acceptance_reject_failed" });
    }
  })
);

/* =========================================================
   POST /api/risk-acceptances/:id/withdraw — REOPENS the finding
   =========================================================
   The only way to "undo" an approved acceptance. The record is never deleted (WORM):
   it moves to 'withdrawn' and the finding comes back as live work. This is also the
   route out of a legacy_unverified acceptance that a human decides was never valid.
   ========================================================= */

router.post(
  "/risk-acceptances/:id/withdraw",
  riskAcceptanceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    try {
      const organizationId = orgOf(req);
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }
      const acceptanceId = req.params.id;
      if (!isUuid(acceptanceId)) {
        res.status(400).json({ error: "invalid_acceptance_id" });
        return;
      }

      const reason = (req.body ?? {})["reason"];

      const existing = await pg.query<{ finding_id: string; state: string }>(
        `SELECT finding_id, state FROM finding_risk_acceptances
          WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [acceptanceId, organizationId]
      );
      const row = existing.rows[0];
      if (!row) {
        res.status(404).json({ error: "acceptance_not_found" });
        return;
      }
      if (!["proposed", "approved", "legacy_unverified"].includes(row.state)) {
        res.status(409).json({ error: "acceptance_not_live", state: row.state });
        return;
      }

      const updated = await pg.query<RiskAcceptance>(
        `UPDATE finding_risk_acceptances
            SET state = 'withdrawn',
                withdrawn_at = NOW(),
                withdrawn_by_user_id = $3,
                withdrawal_reason = $4
          WHERE id = $1 AND organization_id = $2
          RETURNING ${ACCEPTANCE_SELECT}`,
        [
          acceptanceId,
          organizationId,
          (req.userId as string | undefined) ?? null,
          isNonEmptyString(reason) ? reason.trim().slice(0, MAX_RATIONALE) : null,
        ]
      );

      const actor = actorOf(req as never);
      const reopen = await reopenFindingAfterAcceptanceEnded(
        organizationId,
        row.finding_id,
        actor,
        "withdrawn"
      );

      writeAuditEvent({
        organizationId,
        actorUserId: (req.userId as string | undefined) ?? null,
        actorApiKeyId: (req as { apiKey?: { id?: string } }).apiKey?.id ?? null,
        eventType: "finding.risk_acceptance.withdrawn",
        resourceType: "finding_risk_acceptance",
        resourceId: acceptanceId,
        payload: { finding_id: row.finding_id, reopened: reopen.reopened },
        ipAddress: req.ip ?? null,
      });

      res.json({ acceptance: updated.rows[0], finding_reopened: reopen.reopened });
    } catch (err) {
      logger.error({ event: "risk_acceptance_withdraw_failed", err }, "withdraw failed");
      res.status(500).json({ error: "risk_acceptance_withdraw_failed" });
    }
  })
);

/* =========================================================
   GET /api/risk-acceptances — the accepted-risk register
   =========================================================
   THE durable-visibility surface. Closing an accepted-risk Finding removes it from
   Active Findings and every remediation queue; this is where the exposure remains
   governed, with its owner, rationale, approver and review date.

   Filters:
     ?finding_id=UUID            every acceptance (live + terminal history) for ONE finding
     ?state=approved|proposed|expired|withdrawn|rejected|legacy_unverified
     ?expiring_within_days=N     approved acceptances due for review
     ?governance_review_required=true

   The ?finding_id filter is what the Decision Workspace reads: a finding's current
   acceptance plus its full terminal history (the audit trail). It composes with ?state.
   ========================================================= */

router.get(
  "/risk-acceptances",
  riskAcceptanceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    try {
      const organizationId = orgOf(req);
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const conditions: string[] = ["a.organization_id = $1"];
      const params: unknown[] = [organizationId];

      // Per-finding history. The finding you are looking at, its current acceptance and
      // every past one — org-scoped like everything else, so it can never surface another
      // tenant's acceptance even if a finding id were guessed.
      const findingId = req.query.finding_id;
      if (isNonEmptyString(findingId)) {
        if (!isUuid(findingId)) {
          res.status(400).json({ error: "invalid_finding_id" });
          return;
        }
        params.push(findingId.trim());
        conditions.push(`a.finding_id = $${params.length}`);
      }

      const state = req.query.state;
      if (isNonEmptyString(state)) {
        const VALID = new Set([
          "proposed", "approved", "rejected", "withdrawn", "expired", "legacy_unverified",
        ]);
        if (!VALID.has(state)) {
          res.status(400).json({ error: "invalid_state_filter", allowed: [...VALID] });
          return;
        }
        params.push(state);
        conditions.push(`a.state = $${params.length}`);
      }

      const withinRaw = req.query.expiring_within_days;
      if (isNonEmptyString(withinRaw)) {
        const days = Number(withinRaw);
        if (!Number.isInteger(days) || days < 0 || days > 3650) {
          res.status(400).json({ error: "invalid_expiring_within_days" });
          return;
        }
        params.push(days);
        conditions.push(
          `a.state = 'approved' AND a.expires_at IS NOT NULL
             AND a.expires_at <= (CURRENT_DATE + ($${params.length} || ' days')::interval)`
        );
      }

      if (req.query.governance_review_required === "true") {
        conditions.push(`a.governance_review_required = TRUE`);
      }

      const where = conditions.join(" AND ");

      // COUNT over the WHOLE matched set, never the page length — the Metric Contract
      // rule for every entity→findings surface.
      const [rows, total] = await Promise.all([
        pg.query(
          `SELECT ${acceptanceSelect("a")},
                  f.title AS finding_title, f.severity AS finding_severity,
                  f.domain AS finding_domain,
                  f.operational_status AS finding_operational_status,
                  (SELECT COUNT(*)::int FROM evidence e
                    WHERE e.organization_id = a.organization_id
                      AND e.source_type = 'finding_risk_acceptance'
                      AND e.source_id = a.id) AS evidence_count
             FROM finding_risk_acceptances a
             JOIN findings f ON f.id = a.finding_id AND f.organization_id = a.organization_id
            WHERE ${where}
            ORDER BY a.expires_at ASC NULLS LAST, a.created_at DESC
            LIMIT 200`,
          params
        ),
        pg.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM finding_risk_acceptances a WHERE ${where}`,
          params
        ),
      ]);

      res.json({
        acceptances: rows.rows,
        total: parseInt(total.rows[0]?.n ?? "0", 10),
      });
    } catch (err) {
      logger.error({ event: "risk_acceptances_list_failed", err }, "list failed");
      res.status(500).json({ error: "risk_acceptances_list_failed" });
    }
  })
);

/* =========================================================
   GET /api/risk-acceptances/summary — the governance queues
   ========================================================= */

router.get(
  "/risk-acceptances/summary",
  riskAcceptanceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  asTenant(async (req, res) => {
    try {
      const organizationId = orgOf(req);
      if (!organizationId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const r = await pg.query<Record<string, string>>(
        `SELECT
           COUNT(*) FILTER (WHERE a.state = 'proposed')                       AS awaiting_approval,
           COUNT(*) FILTER (WHERE a.state = 'approved')                       AS active_acceptances,
           -- Due for review inside 30 days, and not yet lapsed.
           COUNT(*) FILTER (WHERE a.state = 'approved'
                              AND a.expires_at IS NOT NULL
                              AND a.expires_at >= CURRENT_DATE
                              AND a.expires_at <= CURRENT_DATE + 30)          AS review_due_30d,
           -- Lapsed but not yet swept. The derivation already stopped honouring these,
           -- so a non-zero value here means the expiry worker is behind, not that a
           -- finding is wrongly closed.
           COUNT(*) FILTER (WHERE a.state = 'approved'
                              AND a.expires_at IS NOT NULL
                              AND a.expires_at < CURRENT_DATE)                AS lapsed_pending_sweep,
           COUNT(*) FILTER (WHERE a.state = 'expired')                        AS expired,
           COUNT(*) FILTER (WHERE a.governance_review_required = TRUE
                              AND a.state = 'legacy_unverified')              AS governance_review_required
         FROM finding_risk_acceptances a
        WHERE a.organization_id = $1`,
        [organizationId]
      );
      const row = r.rows[0] ?? {};

      res.json({
        summary: {
          awaiting_approval: parseInt(row["awaiting_approval"] ?? "0", 10),
          active_acceptances: parseInt(row["active_acceptances"] ?? "0", 10),
          review_due_30d: parseInt(row["review_due_30d"] ?? "0", 10),
          lapsed_pending_sweep: parseInt(row["lapsed_pending_sweep"] ?? "0", 10),
          expired: parseInt(row["expired"] ?? "0", 10),
          governance_review_required: parseInt(row["governance_review_required"] ?? "0", 10),
        },
      });
    } catch (err) {
      logger.error({ event: "risk_acceptances_summary_failed", err }, "summary failed");
      res.status(500).json({ error: "risk_acceptances_summary_failed" });
    }
  })
);

export default router;
