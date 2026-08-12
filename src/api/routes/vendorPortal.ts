/**
 * vendorPortal.ts — the EXTERNAL vendor surface.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY ROUTE IN THIS FILE IS REACHABLE WITHOUT A PLATFORM ACCOUNT.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Read the whole file before adding to it. The invariants below are what make
 * an unauthenticated write path safe, and each one is enforced structurally
 * rather than by remembering to check something.
 *
 * INVARIANT 1 — no route accepts an identifier from the caller.
 *   Not organization_id, not vendor_id, not engagement_id, not user_id. Every
 *   identifier comes from `req.portalContext`, which requirePortalSession
 *   resolved from the session ROW. A static test greps this file and fails if
 *   those keys are ever read from a body, query or param.
 *
 * INVARIANT 2 — the session is scoped to exactly ONE engagement.
 *   There is no route that lists engagements, vendors, or anything belonging to
 *   the organisation at large. A vendor cannot enumerate; there is nothing to
 *   enumerate.
 *
 * INVARIANT 3 — writes stop at submission.
 *   isPortalWritable() gates every mutation on the engagement's workflow state.
 *   After `submitted` the questionnaire is evidence, and evidence that can still
 *   change is not evidence.
 *
 * INVARIANT 4 — the flag is a real kill switch.
 *   Off means 404 before any handler runs, and revoking sessions is one UPDATE.
 *
 * The response shapes are deliberately thin. A vendor is shown what they need to
 * answer the questionnaire and nothing else — not the org's other vendors, not
 * internal reviewer names, not risk ratings, not findings.
 */

import { Router, type Response } from "express";

import { pg, pgElevated, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  requirePortalSession,
  type PortalRequest,
} from "../middleware/requirePortalSession.js";
import {
  PORTAL_SESSION_COOKIE,
  checkInviteValidity,
  hashPortalToken,
  hashUserAgent,
  mintSessionToken,
  portalCookieOptions,
} from "../lib/vendorPortal/portalTokens.js";
import { vendorPortalFeatureFlag } from "../lib/vendorPortal/vendorPortalFeatureFlag.js";
import {
  canTransition,
  isPortalWritable,
  type EngagementState,
} from "../lib/vendorRisk/engagementStateMachine.js";

const router = Router();

/** Uniform failure for anything credential-related. Never explains itself. */
function invalidLink(res: Response): void {
  res.status(401).json({ error: "portal_link_invalid" });
}

/* =========================================================
   POST /api/vendor-portal/session
   Exchange an emailed invite token for an httpOnly session cookie.

   This is the ONLY unauthenticated-and-unsessioned route in the platform.
   ========================================================= */
export async function exchangeInviteForSession(
  req: PortalRequest,
  res: Response
): Promise<void> {
  const token = (req.body as Record<string, unknown>)?.token;
  if (typeof token !== "string" || token.length === 0) {
    invalidLink(res);
    return;
  }

  try {
    // Elevated: this lookup PRECEDES org context — it is what establishes it.
    const inviteResult = await pgElevated.query<{
      id: string;
      organization_id: string;
      engagement_id: string;
      expires_at: string;
      revoked_at: string | null;
    }>(
      `SELECT id, organization_id, engagement_id, expires_at, revoked_at
         FROM vendor_engagement_invites
        WHERE invite_token_hash = $1
        LIMIT 1`,
      [hashPortalToken(token)]
    );
    const invite = inviteResult.rows[0] ?? null;

    const validity = checkInviteValidity(
      invite ? { expiresAt: invite.expires_at, revokedAt: invite.revoked_at } : null
    );

    if (!validity.valid) {
      logger.info(
        { event: "portal_invite_rejected", reason: validity.reason },
        "Vendor-portal invite rejected"
      );
      // `expired` is reported distinctly because it is ACTIONABLE for a
      // legitimate vendor ("ask for a new link") and is not a useful oracle: an
      // attacker who already holds a valid 256-bit token learns nothing from
      // being told it aged out, and one who does not cannot reach this branch.
      // revoked and not_found collapse — those WOULD distinguish "this existed
      // and we killed it" from "this never existed".
      if (validity.reason === "expired") {
        res.status(410).json({
          error: "portal_link_expired",
          message: "This link has expired. Please ask your contact for a new one.",
        });
        return;
      }
      invalidLink(res);
      return;
    }

    const session = mintSessionToken();
    const uaHash = hashUserAgent(req.headers["user-agent"] as string | undefined);

    await pgElevated.query(
      `INSERT INTO vendor_portal_sessions
         (organization_id, invite_id, engagement_id, session_token_hash,
          idle_expires_at, absolute_expires_at, created_ip, created_user_agent_sha256,
          last_seen_ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $7)`,
      [
        invite!.organization_id,
        invite!.id,
        invite!.engagement_id,
        session.tokenHash,
        session.idleExpiresAt,
        session.absoluteExpiresAt,
        req.ip ?? null,
        uaHash,
      ]
    );

    await pgElevated.query(
      `UPDATE vendor_engagement_invites
          SET exchange_count = exchange_count + 1,
              last_exchanged_at = NOW(),
              first_exchanged_at = COALESCE(first_exchanged_at, NOW())
        WHERE id = $1`,
      [invite!.id]
    );

    // issued -> in_progress: "the vendor opened the questionnaire". One of the
    // THREE transitions a portal actor may cause, and the state machine is asked
    // rather than the status compared inline. Guarded on the current status in
    // the UPDATE so a concurrent exchange cannot double-transition, and only
    // ever from `issued` — reopening a submitted engagement is not this route's
    // job.
    await withTenant(invite!.organization_id, async () => {
      const eng = await pg.query<{ status: string }>(
        `SELECT status FROM vendor_engagements WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [invite!.engagement_id, invite!.organization_id]
      );
      const from = eng.rows[0]?.status as EngagementState | undefined;
      if (from && canTransition(from, "in_progress", "portal").allowed) {
        await pg.query(
          `UPDATE vendor_engagements
              SET status = 'in_progress', updated_at = NOW()
            WHERE id = $1 AND organization_id = $2 AND status = $3`,
          [invite!.engagement_id, invite!.organization_id, from]
        );
      }
    });

    writeAuditEvent({
      organizationId: invite!.organization_id,
      eventType: "vendor_portal.session.created",
      resourceType: "vendor_engagement",
      resourceId: invite!.engagement_id,
      payload: { invite_id: invite!.id },
      ipAddress: req.ip ?? null,
    });

    res.cookie(
      PORTAL_SESSION_COOKIE,
      session.token,
      portalCookieOptions(session.absoluteExpiresAt, process.env.NODE_ENV === "production")
    );

    // The raw token is NEVER echoed in the body — it lives only in the cookie.
    // The client redirects to a URL with no secret in it, which is the entire
    // point of exchanging the invite rather than using it directly.
    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error({ event: "portal_session_exchange_failed", err }, "Portal session exchange failed");
    invalidLink(res);
  }
}

/* =========================================================
   DELETE /api/vendor-portal/session — sign out.
   ========================================================= */
export async function endPortalSession(req: PortalRequest, res: Response): Promise<void> {
  const ctx = req.portalContext!;
  try {
    await pgElevated.query(
      `UPDATE vendor_portal_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`,
      [ctx.sessionId]
    );
    writeAuditEvent({
      organizationId: ctx.organizationId,
      eventType: "vendor_portal.session.ended",
      resourceType: "vendor_engagement",
      resourceId: ctx.engagementId,
      payload: { invite_id: ctx.inviteId },
      ipAddress: req.ip ?? null,
    });
  } catch (err) {
    logger.warn({ event: "portal_session_end_failed", err }, "Portal sign-out failed (non-fatal)");
  }
  res.clearCookie(PORTAL_SESSION_COOKIE, { path: "/vendor-portal" });
  res.status(200).json({ ok: true });
}

/* =========================================================
   GET /api/vendor-portal/engagement
   What the vendor needs to orient: who is asking, about what, by when.
   ========================================================= */
export async function getPortalEngagement(req: PortalRequest, res: Response): Promise<void> {
  const ctx = req.portalContext!;
  try {
    const result = await withTenant(ctx.organizationId, () =>
      pg.query<{
        status: string;
        title: string | null;
        vendor_name: string;
        org_name: string;
        next_review_due: string | null;
      }>(
        `SELECT e.status, e.title,
                v.name  AS vendor_name,
                o.name  AS org_name,
                e.next_review_due
           FROM vendor_engagements e
           JOIN vendors       v ON v.id = e.vendor_id
           JOIN organizations o ON o.id = e.organization_id
          WHERE e.id = $1 AND e.organization_id = $2
          LIMIT 1`,
        [ctx.engagementId, ctx.organizationId]
      )
    );

    const row = result.rows[0];
    if (!row) {
      // The engagement vanished under a live session (cancelled, deleted).
      invalidLink(res);
      return;
    }

    // DELIBERATELY THIN. A vendor sees who is asking and what state the request
    // is in — never risk ratings, findings, reviewer identities, or anything
    // about the organisation's other vendors.
    res.status(200).json({
      organization_name: row.org_name,
      vendor_name: row.vendor_name,
      title: row.title,
      status: row.status,
      due_date: row.next_review_due,
      accepting_responses: isPortalWritable(row.status as EngagementState),
    });
  } catch (err) {
    logger.error({ event: "portal_engagement_read_failed", err }, "Portal engagement read failed");
    res.status(500).json({ error: "portal_unavailable" });
  }
}

/* =========================================================
   GET /api/vendor-portal/questions
   The FROZEN scope, with each question's "why we're asking", plus whatever the
   vendor has answered so far.
   ========================================================= */
export async function getPortalQuestions(req: PortalRequest, res: Response): Promise<void> {
  const ctx = req.portalContext!;
  try {
    const result = await withTenant(ctx.organizationId, () =>
      pg.query<{
        requirement_id: string;
        reference_id: string;
        title: string;
        description: string | null;
        depth: string;
        mandatory: boolean;
        reasons: unknown;
        status: string | null;
        notes: string | null;
      }>(
        // Only ASKABLE items: deterministic ones, plus AI-suggested ones a human
        // accepted. An unaccepted suggestion must never reach a vendor — that is
        // the ratified AI boundary.
        `SELECT si.requirement_id, r.reference_id, r.title, r.description,
                si.depth, si.mandatory, si.reasons,
                rr.status, rr.notes
           FROM vendor_engagement_scope_items si
           JOIN requirements r ON r.id = si.requirement_id
           LEFT JOIN requirement_responses rr
                  ON rr.requirement_id = si.requirement_id
                 AND rr.engagement_id  = si.engagement_id
                 AND rr.organization_id = si.organization_id
          WHERE si.engagement_id = $1
            AND si.organization_id = $2
            AND (si.source = 'deterministic' OR si.accepted_at IS NOT NULL)
          ORDER BY r.reference_id ASC`,
        [ctx.engagementId, ctx.organizationId]
      )
    );

    res.status(200).json({
      questions: result.rows.map((row) => ({
        requirement_id: row.requirement_id,
        reference: row.reference_id,
        title: row.title,
        guidance: row.description,
        depth: row.depth,
        mandatory: row.mandatory,
        // The justification for the question. A vendor being asked 200 controls
        // deserves to know why each one applies to them.
        why_we_are_asking: row.reasons,
        answer: row.status,
        notes: row.notes,
      })),
    });
  } catch (err) {
    logger.error({ event: "portal_questions_read_failed", err }, "Portal questions read failed");
    res.status(500).json({ error: "portal_unavailable" });
  }
}

/** The structured answer vocabulary. Required — see the effectiveness ladder. */
const PORTAL_ANSWERS = new Set(["pass", "partial", "fail", "not_applicable"]);

/* =========================================================
   PUT /api/vendor-portal/questions/:requirementId
   Save one answer. Idempotent; every save writes a revision.
   ========================================================= */
export async function savePortalAnswer(req: PortalRequest, res: Response): Promise<void> {
  const ctx = req.portalContext!;
  const requirementId = String(req.params["requirementId"] ?? "").trim();
  const body = (req.body ?? {}) as Record<string, unknown>;
  const status = typeof body.answer === "string" ? body.answer : "";
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 4000) : null;

  // A STRUCTURED answer is required, not optional prose. The control-
  // effectiveness ladder consumes this value deterministically; free text alone
  // would make effectiveness un-computable without an LLM and break the
  // LLM-independence invariant.
  if (!PORTAL_ANSWERS.has(status)) {
    res.status(400).json({
      error: "invalid_answer",
      allowed: [...PORTAL_ANSWERS],
      message: "Choose one of the available answers. Notes are optional and supplement it.",
    });
    return;
  }

  try {
    const outcome = await withTenant(ctx.organizationId, async () => {
      // The engagement must still be accepting responses. After submission the
      // questionnaire is evidence, and evidence that can still change is not
      // evidence.
      const eng = await pg.query<{ status: string }>(
        `SELECT status FROM vendor_engagements WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [ctx.engagementId, ctx.organizationId]
      );
      const state = eng.rows[0]?.status as EngagementState | undefined;
      if (!state) return { code: 401 as const };
      if (!isPortalWritable(state)) return { code: 409 as const, state };

      // The requirement must be IN THIS ENGAGEMENT'S FROZEN SCOPE. A vendor
      // cannot answer a question they were not asked, and cannot reach another
      // engagement's requirement by id.
      const inScope = await pg.query(
        `SELECT 1 FROM vendor_engagement_scope_items
          WHERE engagement_id = $1 AND organization_id = $2 AND requirement_id = $3
            AND (source = 'deterministic' OR accepted_at IS NOT NULL)
          LIMIT 1`,
        [ctx.engagementId, ctx.organizationId, requirementId]
      );
      if ((inScope.rowCount ?? 0) === 0) return { code: 404 as const };

      // subject_id is the ENGAGEMENT'S vendor, resolved server-side.
      const vendor = await pg.query<{ vendor_id: string }>(
        `SELECT vendor_id FROM vendor_engagements WHERE id = $1 AND organization_id = $2`,
        [ctx.engagementId, ctx.organizationId]
      );
      const vendorId = vendor.rows[0]!.vendor_id;

      const saved = await pg.query<{ id: string }>(
        `INSERT INTO requirement_responses
           (organization_id, requirement_id, assessment_type, subject_id, engagement_id,
            responder_type, answered_via_invite_id, status, notes, assessed_at)
         VALUES ($1, $2, 'vendor', $3, $4, 'vendor', $5, $6, $7, NOW())
         ON CONFLICT (organization_id, requirement_id, assessment_type, subject_id,
                      COALESCE(engagement_id, '00000000-0000-0000-0000-000000000000'::uuid))
         DO UPDATE SET status = EXCLUDED.status,
                       notes = EXCLUDED.notes,
                       responder_type = EXCLUDED.responder_type,
                       answered_via_invite_id = EXCLUDED.answered_via_invite_id,
                       assessed_at = NOW(),
                       updated_at = NOW()
         RETURNING id`,
        [ctx.organizationId, requirementId, vendorId, ctx.engagementId, ctx.inviteId, status, notes]
      );

      // Append-only history. The upsert above cannot answer "what did they say
      // before they changed it"; this can.
      await pg.query(
        `INSERT INTO requirement_response_revisions
           (organization_id, response_id, status, notes, responder_type, answered_via_invite_id)
         VALUES ($1, $2, $3, $4, 'vendor', $5)`,
        [ctx.organizationId, saved.rows[0]!.id, status, notes, ctx.inviteId]
      );

      return { code: 200 as const };
    });

    if (outcome.code === 401) {
      invalidLink(res);
      return;
    }
    if (outcome.code === 409) {
      res.status(409).json({
        error: "responses_closed",
        message: "This questionnaire has been submitted and is no longer accepting changes.",
      });
      return;
    }
    if (outcome.code === 404) {
      // Not-in-scope and does-not-exist are indistinguishable: a vendor must not
      // be able to probe which requirements another engagement covers.
      res.status(404).json({ error: "question_not_found" });
      return;
    }

    writeAuditEvent({
      organizationId: ctx.organizationId,
      eventType: "vendor_portal.response.saved",
      resourceType: "vendor_engagement",
      resourceId: ctx.engagementId,
      payload: { requirement_id: requirementId, answer: status, invite_id: ctx.inviteId },
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error({ event: "portal_answer_save_failed", err }, "Portal answer save failed");
    res.status(500).json({ error: "portal_unavailable" });
  }
}

/* =========================================================
   POST /api/vendor-portal/submit
   in_progress -> submitted. One of the THREE transitions a portal session may
   cause; the state machine is the authority.
   ========================================================= */
export async function submitPortalResponses(req: PortalRequest, res: Response): Promise<void> {
  const ctx = req.portalContext!;
  try {
    const outcome = await withTenant(ctx.organizationId, async () => {
      const eng = await pg.query<{ status: string }>(
        `SELECT status FROM vendor_engagements WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [ctx.engagementId, ctx.organizationId]
      );
      const from = eng.rows[0]?.status as EngagementState | undefined;
      if (!from) return { code: 401 as const };

      // The state machine decides legality — including that a portal actor may
      // cause this transition at all. Handlers never hand-roll a status check.
      const check = canTransition(from, "submitted", "portal");
      if (!check.allowed) return { code: 409 as const, from, reason: check.reason };

      // Guard `all_mandatory_answered`, declared on the transition.
      const unanswered = await pg.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n
           FROM vendor_engagement_scope_items si
           LEFT JOIN requirement_responses rr
                  ON rr.requirement_id = si.requirement_id
                 AND rr.engagement_id  = si.engagement_id
                 AND rr.organization_id = si.organization_id
          WHERE si.engagement_id = $1 AND si.organization_id = $2
            AND si.mandatory = TRUE
            AND (si.source = 'deterministic' OR si.accepted_at IS NOT NULL)
            AND rr.status IS NULL`,
        [ctx.engagementId, ctx.organizationId]
      );
      const remaining = Number(unanswered.rows[0]?.n ?? "0");
      if (remaining > 0) return { code: 422 as const, remaining };

      await pg.query(
        `UPDATE vendor_engagements
            SET status = 'submitted', submitted_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND organization_id = $2 AND status = $3`,
        [ctx.engagementId, ctx.organizationId, from]
      );
      return { code: 200 as const };
    });

    if (outcome.code === 401) {
      invalidLink(res);
      return;
    }
    if (outcome.code === 409) {
      res.status(409).json({
        error: "cannot_submit",
        message: "This questionnaire is not currently open for submission.",
      });
      return;
    }
    if (outcome.code === 422) {
      res.status(422).json({
        error: "incomplete",
        unanswered_required: outcome.remaining,
        message: `${outcome.remaining} required question(s) still need an answer.`,
      });
      return;
    }

    writeAuditEvent({
      organizationId: ctx.organizationId,
      eventType: "vendor_portal.submitted",
      resourceType: "vendor_engagement",
      resourceId: ctx.engagementId,
      payload: { invite_id: ctx.inviteId },
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({ ok: true, status: "submitted" });
  } catch (err) {
    logger.error({ event: "portal_submit_failed", err }, "Portal submit failed");
    res.status(500).json({ error: "portal_unavailable" });
  }
}

// ---------------------------------------------------------------------------
// Router wiring
//
// The flag is FIRST on every route: off means 404 before any handler, any DB
// read, and — on the exchange route — before any token is even hashed.
// ---------------------------------------------------------------------------

router.post("/vendor-portal/session", vendorPortalFeatureFlag, exchangeInviteForSession);

router.delete(
  "/vendor-portal/session",
  vendorPortalFeatureFlag,
  requirePortalSession,
  endPortalSession
);

router.get(
  "/vendor-portal/engagement",
  vendorPortalFeatureFlag,
  requirePortalSession,
  getPortalEngagement
);

router.get(
  "/vendor-portal/questions",
  vendorPortalFeatureFlag,
  requirePortalSession,
  getPortalQuestions
);

router.put(
  "/vendor-portal/questions/:requirementId",
  vendorPortalFeatureFlag,
  requirePortalSession,
  savePortalAnswer
);

router.post(
  "/vendor-portal/submit",
  vendorPortalFeatureFlag,
  requirePortalSession,
  submitPortalResponses
);

export default router;
