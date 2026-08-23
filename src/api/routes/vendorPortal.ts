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

import { createHash, randomUUID } from "node:crypto";

import { Router, type Request, type Response } from "express";
import multer from "multer";

import { pg, pgElevated, withTenant } from "../infra/postgres.js";
import {
  portalExchangeRateLimiter,
  recordExchangeFailure,
} from "../middleware/portalExchangeRateLimiter.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  requirePortalSession,
  portalCanCoordinate,
  type PortalRequest,
} from "../middleware/requirePortalSession.js";
import {
  addParticipant,
  listParticipants,
  resolveParticipant,
  revokeParticipant,
} from "../lib/vendorPortal/participants.js";
import { sendVendorInviteEmail } from "../lib/vendorPortal/inviteEmail.js";

/**
 * VA-P1. Same shape the customer-side issue path and vendor_contacts' CHECK
 * use — deliberately identical, so a name the directory accepts is a name the
 * portal accepts and neither side can create a person the other refuses.
 */
const PORTAL_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
  MAX_PORTAL_FILE_BYTES,
  checkEngagementQuota,
  validateComment,
} from "../lib/vendorPortal/portalUploadPolicy.js";
import {
  ALLOWED_UPLOAD_LABELS,
  isAllowedUploadMime,
  validateEvidenceFile,
} from "../lib/evidenceFileValidation.js";
import {
  BlobStorageMalformedConfigError,
  BlobStorageNotConfiguredError,
} from "../lib/blobStorageConfig.js";
import {
  deleteEvidenceFile,
  evidenceObjectKey,
  putEvidenceFile,
} from "../lib/evidenceStorage.js";
import {
  canTransition,
  isPortalCommentable,
  isPortalRespondable,
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
  // Every rejection below is charged to the caller's address (VA-S1a). A
  // SUCCESSFUL exchange costs nothing: a vendor office behind one NAT address
  // legitimately exchanges valid links all day, and what no honest caller does
  // is present tokens that do not resolve.
  const chargeFailure = (): void => recordExchangeFailure(req.ip ?? "unknown");
  if (typeof token !== "string" || token.length === 0) {
    chargeFailure();
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
      participant_id: string | null;
      participant_revoked_at: string | null;
    }>(
      `SELECT i.id, i.organization_id, i.engagement_id, i.expires_at, i.revoked_at,
              i.participant_id, p.revoked_at AS participant_revoked_at
         FROM vendor_engagement_invites i
         LEFT JOIN vendor_engagement_participants p ON p.id = i.participant_id
        WHERE i.invite_token_hash = $1
        LIMIT 1`,
      [hashPortalToken(token)]
    );
    const invite = inviteResult.rows[0] ?? null;

    const validity = checkInviteValidity(
      invite
        ? {
            expiresAt: invite.expires_at,
            // VA-P1: a revoked PARTICIPANT cannot exchange, even if their
            // invite somehow outlived the revocation. Collapsed into the same
            // `revoked` reason on purpose — it must not become an oracle that
            // distinguishes "this person was removed" from "no such link".
            revokedAt: invite.revoked_at ?? invite.participant_revoked_at,
          }
        : null
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
      chargeFailure();
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

    // VA-P1: invited -> active. `first_accepted_at` is COALESCEd so it records
    // the first time this person ever walked through the door, not the last;
    // the CHECK on the table refuses `active` without it. Elevated for the same
    // reason as everything else on this path — org context does not exist yet.
    if (invite!.participant_id) {
      await pgElevated.query(
        `UPDATE vendor_engagement_participants
            SET status = 'active',
                first_accepted_at = COALESCE(first_accepted_at, NOW()),
                last_accepted_at = NOW(),
                updated_at = NOW()
          WHERE id = $1 AND revoked_at IS NULL`,
        [invite!.participant_id]
      );
    }

    // issued -> in_progress: "the vendor opened the questionnaire". One of the
    // THREE transitions a portal actor may cause. Guarded on the current status
    // in the UPDATE so a concurrent exchange cannot double-transition.
    //
    // The `from === "issued"` test is EXPLICIT and is not the same question as
    // "does the state machine permit this transition". Two source states can
    // reach `in_progress` by a portal actor — `issued` and
    // `clarification_requested` — and asking only the transition table would
    // make merely OPENING THE LINK mark a clarification request as answered.
    // Opening a link is not answering; the clarification resume belongs to a
    // real write, and lives in `resumeFromClarification`.
    await withTenant(invite!.organization_id, async () => {
      const eng = await pg.query<{ status: string }>(
        `SELECT status FROM vendor_engagements WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [invite!.engagement_id, invite!.organization_id]
      );
      const from = eng.rows[0]?.status as EngagementState | undefined;
      if (from === "issued" && canTransition(from, "in_progress", "portal").allowed) {
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
      payload: { invite_id: invite!.id, participant_id: invite!.participant_id },
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
  // Path must byte-match the set path or the browser keeps the old cookie.
  res.clearCookie(PORTAL_SESSION_COOKIE, { path: "/api/vendor-portal" });
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
      // Respondable, not writable: during a clarification the questionnaire IS
      // accepting the vendor's revised answers — that is the point of the state.
      accepting_responses: isPortalRespondable(row.status as EngagementState),
      // VA-P1: whether THIS person may submit. Sent so the review screen can
      // explain who to ask instead of offering a button that 403s — a
      // contributor discovering the rule by being refused is a worse product
      // than a contributor being told the rule.
      can_submit: portalCanCoordinate(req),
      participant_role: ctx.participantRole,
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
        answered_at: string | null;
        answered_by_name: string | null;
        answered_by_participant_id: string | null;
      }>(
        // Only ASKABLE items: deterministic ones, plus AI-suggested ones a human
        // accepted. An unaccepted suggestion must never reach a vendor — that is
        // the ratified AI boundary.
        // VA-P1: `updated_at` and the answering PERSON travel with each
        // question. Both exist for the same reason — several colleagues now
        // share one document. The timestamp is the optimistic-concurrency
        // token the save path checks; the name is so a teammate can see whose
        // answer they are about to change rather than discovering it after.
        // Resolved through the EXISTING answered_via_invite_id column: invite
        // -> participant -> contact. No new attribution column, and nothing
        // that later edits to a contact can rewrite retroactively.
        `SELECT si.requirement_id, r.reference_id, r.title, r.description,
                si.depth, si.mandatory, si.reasons,
                rr.status, rr.notes, rr.updated_at AS answered_at,
                ac.full_name AS answered_by_name,
                ai.participant_id AS answered_by_participant_id
           FROM vendor_engagement_scope_items si
           JOIN requirements r ON r.id = si.requirement_id
           LEFT JOIN requirement_responses rr
                  ON rr.requirement_id = si.requirement_id
                 AND rr.engagement_id  = si.engagement_id
                 AND rr.organization_id = si.organization_id
           LEFT JOIN vendor_engagement_invites ai ON ai.id = rr.answered_via_invite_id
           LEFT JOIN vendor_engagement_participants ap ON ap.id = ai.participant_id
           LEFT JOIN vendor_contacts ac ON ac.id = ap.contact_id
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
        // VA-P1 collaboration surface: who last touched this, when, and whether
        // that was you. `answered_at` doubles as the concurrency token the save
        // path accepts back as `prev_answered_at`.
        answered_at: row.answered_at,
        answered_by_name: row.answered_by_name,
        answered_by_you:
          row.answered_by_participant_id !== null &&
          row.answered_by_participant_id === ctx.participantId,
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

  // VA-P1 — LOST-UPDATE GUARD.
  //
  // The upsert below is last-write-wins. With one respondent that was fine.
  // With colleagues sharing one questionnaire, two people editing the same
  // control means the slower save silently replaces the faster one and the
  // author never learns it happened — the revisions ledger preserves the lost
  // text, but nothing tells anybody to go looking.
  //
  // The smallest honest fix, and deliberately not live collaborative editing:
  // the client echoes back the `answered_at` it rendered, and a save whose
  // stored value has moved on since is refused with the current answer so the
  // UI can show what changed. OPTIONAL by construction — omitting it keeps the
  // old last-write-wins behaviour, so no existing client breaks and no
  // in-flight engagement stalls. The check is inside the same transaction as
  // the write, so it is a real guard rather than a read-then-hope.
  const expectedAnsweredAt =
    typeof body.prev_answered_at === "string" && body.prev_answered_at.trim()
      ? body.prev_answered_at.trim()
      : null;

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
      // RESPONDABLE, not merely writable: `clarification_requested` is exactly
      // the state where the reviewer has asked the vendor to change an answer.
      // Gating on the narrow write window here meant a vendor asked for
      // clarification got 409 on every answer edit — the one edit the state
      // exists to invite (the state machine's clarification_requested ->
      // in_progress transition is caused by this very write).
      if (!isPortalRespondable(state)) return { code: 409 as const, state };

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

      if (expectedAnsweredAt !== null) {
        const current = await pg.query<{ updated_at: string; full_name: string | null }>(
          `SELECT rr.updated_at, ac.full_name
             FROM requirement_responses rr
             LEFT JOIN vendor_engagement_invites ai ON ai.id = rr.answered_via_invite_id
             LEFT JOIN vendor_engagement_participants ap ON ap.id = ai.participant_id
             LEFT JOIN vendor_contacts ac ON ac.id = ap.contact_id
            WHERE rr.requirement_id = $1 AND rr.engagement_id = $2
              AND rr.organization_id = $3
            LIMIT 1`,
          [requirementId, ctx.engagementId, ctx.organizationId]
        );
        const stored = current.rows[0]?.updated_at ?? null;
        // Compared as instants, not strings: the client round-trips an ISO
        // string through JSON and Postgres renders its own format.
        const moved =
          stored !== null &&
          new Date(stored).getTime() !== new Date(expectedAnsweredAt).getTime();
        if (moved) {
          return {
            code: 412 as const,
            conflict: {
              answered_at: stored,
              answered_by_name: current.rows[0]?.full_name ?? null,
            },
          };
        }
      }

      // subject_id is the ENGAGEMENT'S vendor, resolved server-side.
      const vendor = await pg.query<{ vendor_id: string }>(
        `SELECT vendor_id FROM vendor_engagements WHERE id = $1 AND organization_id = $2`,
        [ctx.engagementId, ctx.organizationId]
      );
      const vendorId = vendor.rows[0]!.vendor_id;

      const saved = await pg.query<{ id: string; updated_at: string }>(
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
         RETURNING id, updated_at`,
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

      // Answering during a clarification is what reopens the engagement —
      // the state machine's clarification_requested -> in_progress transition.
      await resumeFromClarification(ctx.organizationId, ctx.engagementId, state);

      // The new concurrency token travels back with the acknowledgement. Without
      // it a client that saves twice would send a token one revision stale and
      // get a 412 caused by its own previous save.
      return { code: 200 as const, answeredAt: saved.rows[0]!.updated_at };
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
    if (outcome.code === 412) {
      // A colleague changed this answer since the page was rendered. 412 rather
      // than 409 because 409 already means "the questionnaire is closed" on
      // this handler, and the two need different words in the UI: one is
      // "refresh and look at what changed", the other is "you are finished".
      res.status(412).json({
        error: "answer_changed",
        message: outcome.conflict.answered_by_name
          ? `${outcome.conflict.answered_by_name} changed this answer while you were working on it. Reload to see their version before saving yours.`
          : "This answer changed while you were working on it. Reload to see the current version before saving yours.",
        current_answered_at: outcome.conflict.answered_at,
        current_answered_by_name: outcome.conflict.answered_by_name,
      });
      return;
    }

    writeAuditEvent({
      organizationId: ctx.organizationId,
      eventType: "vendor_portal.response.saved",
      resourceType: "vendor_engagement",
      resourceId: ctx.engagementId,
      // VA-P1: the answer is attributable to a PERSON now, not just a token.
      payload: {
        requirement_id: requirementId,
        answer: status,
        invite_id: ctx.inviteId,
        participant_id: ctx.participantId,
      },
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({ ok: true, answered_at: outcome.answeredAt });
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

  // VA-P1 — SUBMISSION AUTHORITY. Submitting freezes the questionnaire: after
  // this the answers are evidence, and evidence that can still change is not
  // evidence. With several people at the supplier working the same document,
  // any one of them being able to end everyone else's work mid-sentence is not
  // a permission anybody granted. The coordinator is the person the customer
  // addressed the assessment to, and they alone submit.
  //
  // A pre-VA-P1 session (no participant record) is the engagement's sole
  // recipient and keeps the authority it always had — see portalCanCoordinate.
  if (!portalCanCoordinate(req)) {
    res.status(403).json({
      error: "not_coordinator",
      message:
        "Only the main contact for this assessment can submit it. Ask them to review and send it back.",
    });
    return;
  }

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
      // VA-P1: submission was attributed to NOBODY before this — the memory of
      // who ended the questionnaire lived only in an invite id.
      payload: {
        invite_id: ctx.inviteId,
        participant_id: ctx.participantId,
        contact_id: ctx.contactId,
      },
      ipAddress: req.ip ?? null,
    });

    // Enqueue evidence analysis — one durable job per attached file, claimed by
    // the out-of-process worker that holds the model key. Gated on a key being
    // configured ANYWHERE in this deployment topology being pointless to check
    // from here — the honest gate is that an LLM-less environment simply leaves
    // these queued jobs to no-op via the worker's own flag/key gates, and
    // `analysis_coverage` stays deterministic_only. Fire-and-forget: a failed
    // enqueue must never fail the vendor's submission.
    try {
      await withTenant(ctx.organizationId, async () => {
        await pg.query(
          `INSERT INTO jobs (organization_id, requested_by_user_id, job_type, payload)
           SELECT e.organization_id, NULL, 'vendor_evidence_analysis',
                  jsonb_build_object('evidenceId', e.id, 'engagementId', e.engagement_id)
             FROM evidence e
            WHERE e.organization_id = $1 AND e.engagement_id = $2
              AND e.detached_at IS NULL AND e.storage_key IS NOT NULL
              AND NOT EXISTS (
                    SELECT 1 FROM evidence_analysis a WHERE a.evidence_id = e.id
                  )
              AND NOT EXISTS (
                    SELECT 1 FROM jobs j
                     WHERE j.job_type = 'vendor_evidence_analysis'
                       AND j.organization_id = e.organization_id
                       AND j.payload->>'evidenceId' = e.id::text
                       AND j.status IN ('queued', 'processing')
                  )`,
          [ctx.organizationId, ctx.engagementId]
        );
      });
    } catch (enqueueErr) {
      logger.error(
        { event: "evidence_analysis_enqueue_failed", engagementId: ctx.engagementId, err: enqueueErr },
        "Evidence-analysis enqueue failed (submission unaffected)"
      );
    }

    res.status(200).json({ ok: true, status: "submitted" });
  } catch (err) {
    logger.error({ event: "portal_submit_failed", err }, "Portal submit failed");
    res.status(500).json({ error: "portal_unavailable" });
  }
}

/* =========================================================
   Shared: read the engagement's state, and let a write in
   `clarification_requested` cause the transition back to `in_progress`.

   This is the THIRD and last transition a portal actor may cause. It is caused
   by responding, not by pressing a button — a vendor who has been asked to
   clarify has already been told what to do, and an extra "I am now working on
   it" step is a state the vendor has to maintain on our behalf.
   ========================================================= */
async function portalWriteWindow(
  organizationId: string,
  engagementId: string
): Promise<{ state: EngagementState } | null> {
  const eng = await pg.query<{ status: string }>(
    `SELECT status FROM vendor_engagements WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [engagementId, organizationId]
  );
  const state = eng.rows[0]?.status as EngagementState | undefined;
  return state ? { state } : null;
}

async function resumeFromClarification(
  organizationId: string,
  engagementId: string,
  state: EngagementState
): Promise<void> {
  if (state !== "clarification_requested") return;
  if (!canTransition(state, "in_progress", "portal").allowed) return;
  await pg.query(
    `UPDATE vendor_engagements
        SET status = 'in_progress', updated_at = NOW()
      WHERE id = $1 AND organization_id = $2 AND status = $3`,
    [engagementId, organizationId, state]
  );
}

/* =========================================================
   POST /api/vendor-portal/evidence   (multipart/form-data)

   Fail-closed ordering, matching the internal evidence route so the two cannot
   drift into different safety properties:
     1. multer bounds the body (size + single file + declared-MIME allowlist);
     2. authoritative content validation — allowlist + magic bytes + NUL sniff;
     3. the engagement must be accepting responses;
     4. the PER-ENGAGEMENT quota (see portalUploadPolicy for why the org-wide
        cap is not sufficient on an externally-reachable surface);
     5. write the blob;
     6. INSERT the row in one tenant transaction — and delete the blob if that
        fails, so a failed upload leaves nothing behind.
   ========================================================= */
export async function uploadPortalEvidence(req: PortalRequest, res: Response): Promise<void> {
  const ctx = req.portalContext!;
  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file) {
    res.status(400).json({ error: "no_file_uploaded", message: "Choose a file to attach." });
    return;
  }

  // The SAME validator the internal route uses. A second allowlist here would be
  // a second source of truth, and the external one is the one that must not lag.
  const fileCheck = validateEvidenceFile({
    declaredMime: file.mimetype,
    buffer: file.buffer,
    size: file.size,
    originalName: file.originalname,
  });
  if (!fileCheck.ok) {
    res.status(fileCheck.error === "file_too_large" ? 413 : 400).json(fileCheck);
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const title =
    typeof body.title === "string" && body.title.trim().length > 0
      ? body.title.trim().slice(0, 300)
      : fileCheck.filename;
  // Optional anchor to one question. NOT an authorization identifier — it is
  // validated against this engagement's frozen scope below, exactly as the
  // answer route validates it.
  const requirementId =
    typeof body.requirement_id === "string" && body.requirement_id.trim().length > 0
      ? body.requirement_id.trim()
      : null;

  const evidenceId = randomUUID();
  const sha256 = createHash("sha256").update(file.buffer).digest("hex");

  try {
    // ── Steps 3 and 4, before a single byte is stored. ──────────────────────
    const pre = await withTenant(ctx.organizationId, async () => {
      const win = await portalWriteWindow(ctx.organizationId, ctx.engagementId);
      if (!win) return { code: 401 as const };
      if (!isPortalRespondable(win.state)) return { code: 409 as const };

      if (requirementId) {
        const inScope = await pg.query(
          `SELECT 1 FROM vendor_engagement_scope_items
            WHERE engagement_id = $1 AND organization_id = $2 AND requirement_id = $3
              AND (source = 'deterministic' OR accepted_at IS NOT NULL)
            LIMIT 1`,
          [ctx.engagementId, ctx.organizationId, requirementId]
        );
        if ((inScope.rowCount ?? 0) === 0) return { code: 404 as const };
      }

      const usage = await pg.query<{ bytes: string; files: string }>(
        `SELECT COALESCE(SUM(byte_size), 0)::text AS bytes,
                COUNT(*)::text                     AS files
           FROM evidence
          WHERE organization_id = $1
            AND engagement_id   = $2
            AND storage_key IS NOT NULL
            AND detached_at IS NULL`,
        [ctx.organizationId, ctx.engagementId]
      );
      const quota = checkEngagementQuota({
        usedBytes: Number(usage.rows[0]?.bytes ?? "0"),
        usedFiles: Number(usage.rows[0]?.files ?? "0"),
        incomingBytes: file.size,
      });
      if (!quota.ok) return { code: 413 as const, quota };

      return { code: 200 as const, state: win.state };
    });

    if (pre.code === 401) return invalidLink(res);
    if (pre.code === 409) {
      res.status(409).json({
        error: "responses_closed",
        message: "This request is no longer accepting attachments.",
      });
      return;
    }
    if (pre.code === 404) {
      res.status(404).json({ error: "question_not_found" });
      return;
    }
    if (pre.code === 413) {
      res.status(413).json(pre.quota);
      return;
    }

    // ── Step 5: the blob. ───────────────────────────────────────────────────
    try {
      await putEvidenceFile({
        organizationId: ctx.organizationId,
        evidenceId,
        bytes: file.buffer,
        contentType: fileCheck.mime,
        filename: fileCheck.filename,
      });
    } catch (err) {
      if (
        err instanceof BlobStorageNotConfiguredError ||
        err instanceof BlobStorageMalformedConfigError
      ) {
        logger.error(
          { event: "portal_storage_unconfigured", organizationId: ctx.organizationId },
          "Vendor-portal upload attempted but blob storage is not configured"
        );
        res.status(503).json({
          error: "storage_unavailable",
          message: "Attachments are temporarily unavailable. Your answers are saved.",
        });
        return;
      }
      logger.error({ event: "portal_blob_put_failed", evidenceId, err }, "Portal blob put failed");
      res.status(500).json({ error: "upload_failed" });
      return;
    }

    // ── Step 6: the row. ────────────────────────────────────────────────────
    try {
      await withTenant(ctx.organizationId, async () => {
        await pg.query(
          `INSERT INTO evidence (
             id, organization_id, source_type, source_id, title,
             evidence_type, storage_key, original_filename, mime_type, byte_size,
             sha256, uploaded_by_user_id, engagement_id, requirement_id,
             uploaded_via_invite_id
           )
           VALUES ($1, $2, 'vendor_engagement', $3::uuid, $4,
                   'document', $5, $6, $7, $8,
                   $9, NULL, $3::uuid, $10, $11)`,
          [
            evidenceId,
            ctx.organizationId,
            ctx.engagementId,
            title,
            evidenceObjectKey(ctx.organizationId, evidenceId),
            fileCheck.filename,
            fileCheck.mime,
            file.size,
            sha256,
            requirementId,
            ctx.inviteId,
          ]
        );
        await resumeFromClarification(ctx.organizationId, ctx.engagementId, pre.state);
      });
    } catch (err) {
      try {
        await deleteEvidenceFile({ organizationId: ctx.organizationId, evidenceId });
      } catch (cleanupErr) {
        logger.error(
          { event: "portal_blob_cleanup_failed", evidenceId, err: cleanupErr },
          "Failed to remove orphaned portal blob"
        );
      }
      logger.error({ event: "portal_evidence_insert_failed", evidenceId, err }, "Portal evidence insert failed");
      res.status(500).json({ error: "upload_failed" });
      return;
    }

    writeAuditEvent({
      organizationId: ctx.organizationId,
      eventType: "vendor_portal.evidence.uploaded",
      resourceType: "vendor_engagement",
      resourceId: ctx.engagementId,
      payload: {
        evidence_id: evidenceId,
        invite_id: ctx.inviteId,
        // VA-P1: which PERSON at the supplier attached this.
        participant_id: ctx.participantId,
        filename: fileCheck.filename,
        byte_size: file.size,
        sha256,
        requirement_id: requirementId,
      },
      ipAddress: req.ip ?? null,
    });

    res.status(201).json({
      id: evidenceId,
      filename: fileCheck.filename,
      byte_size: file.size,
      requirement_id: requirementId,
    });
  } catch (err) {
    logger.error({ event: "portal_evidence_upload_failed", err }, "Portal evidence upload failed");
    res.status(500).json({ error: "portal_unavailable" });
  }
}

/* =========================================================
   GET /api/vendor-portal/evidence — what the vendor has attached.

   METADATA ONLY. There is deliberately no download route and no signed URL on
   this surface. The vendor already holds every file they sent; giving them a
   read channel back into the org's evidence store buys them nothing and creates
   an unauthenticated path to blob bytes whose blast radius, if it ever mis-scopes,
   is the customer's entire evidence library rather than one row.
   ========================================================= */
export async function listPortalEvidence(req: PortalRequest, res: Response): Promise<void> {
  const ctx = req.portalContext!;
  try {
    const result = await withTenant(ctx.organizationId, () =>
      pg.query<{
        id: string;
        title: string;
        original_filename: string;
        byte_size: string;
        requirement_id: string | null;
        reference_id: string | null;
        created_at: string;
        uploaded_via_invite_id: string | null;
      }>(
        // Scoped to the engagement AND to vendor-supplied rows. An engagement's
        // evidence set also contains files the ORG attached internally; those are
        // not the vendor's to see.
        `SELECT e.id, e.title, e.original_filename, e.byte_size::text AS byte_size,
                e.requirement_id, r.reference_id, e.created_at, e.uploaded_via_invite_id
           FROM evidence e
           LEFT JOIN requirements r ON r.id = e.requirement_id
          WHERE e.organization_id = $1
            AND e.engagement_id   = $2
            AND e.uploaded_via_invite_id IS NOT NULL
            AND e.detached_at IS NULL
          ORDER BY e.created_at ASC`,
        [ctx.organizationId, ctx.engagementId]
      )
    );

    const state = await withTenant(ctx.organizationId, () =>
      portalWriteWindow(ctx.organizationId, ctx.engagementId)
    );

    res.status(200).json({
      files: result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        filename: row.original_filename,
        byte_size: Number(row.byte_size),
        requirement_id: row.requirement_id,
        requirement_reference: row.reference_id,
        uploaded_at: row.created_at,
      })),
      accepting_uploads: state ? isPortalRespondable(state.state) : false,
    });
  } catch (err) {
    logger.error({ event: "portal_evidence_list_failed", err }, "Portal evidence list failed");
    res.status(500).json({ error: "portal_unavailable" });
  }
}

/* =========================================================
   DELETE /api/vendor-portal/evidence/:evidenceId — withdraw an attachment.

   A hard delete, and deliberately so: a vendor who attached the wrong document
   — the wrong client's report, an unredacted export — needs it gone, not
   flagged. The audit event records filename, size and SHA-256, so the FACT of
   the upload survives the file.

   The WHERE clause is what makes this safe to expose externally. Deletion is
   restricted to rows that are in this engagement AND were supplied through the
   portal, so the reachable set is exactly "files this vendor sent us".
   ========================================================= */
export async function deletePortalEvidence(req: PortalRequest, res: Response): Promise<void> {
  const ctx = req.portalContext!;
  const evidenceId = String(req.params["evidenceId"] ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(evidenceId)) {
    res.status(404).json({ error: "attachment_not_found" });
    return;
  }

  try {
    const outcome = await withTenant(ctx.organizationId, async () => {
      const win = await portalWriteWindow(ctx.organizationId, ctx.engagementId);
      if (!win) return { code: 401 as const };
      if (!isPortalRespondable(win.state)) return { code: 409 as const };

      // Row first, blob second. The reverse order can leave a row pointing at a
      // blob that no longer exists, which is a broken record; this order can at
      // worst leave an unreferenced blob, which is inert.
      const del = await pg.query<{
        original_filename: string;
        byte_size: string;
        sha256: string;
      }>(
        `DELETE FROM evidence
          WHERE id = $1
            AND organization_id = $2
            AND engagement_id   = $3
            AND uploaded_via_invite_id IS NOT NULL
          RETURNING original_filename, byte_size::text AS byte_size, sha256`,
        [evidenceId, ctx.organizationId, ctx.engagementId]
      );
      if ((del.rowCount ?? 0) === 0) return { code: 404 as const };

      await resumeFromClarification(ctx.organizationId, ctx.engagementId, win.state);
      return { code: 200 as const, row: del.rows[0]! };
    });

    if (outcome.code === 401) return invalidLink(res);
    if (outcome.code === 409) {
      res.status(409).json({
        error: "responses_closed",
        message: "This request is no longer accepting changes.",
      });
      return;
    }
    if (outcome.code === 404) {
      res.status(404).json({ error: "attachment_not_found" });
      return;
    }

    try {
      await deleteEvidenceFile({ organizationId: ctx.organizationId, evidenceId });
    } catch (err) {
      // The row is gone, so the file is unreachable through the product. An
      // orphaned object is a storage-hygiene problem, not a correctness one.
      logger.error(
        { event: "portal_blob_delete_failed", evidenceId, err },
        "Portal attachment row deleted but blob removal failed"
      );
    }

    writeAuditEvent({
      organizationId: ctx.organizationId,
      eventType: "vendor_portal.evidence.withdrawn",
      resourceType: "vendor_engagement",
      resourceId: ctx.engagementId,
      payload: {
        evidence_id: evidenceId,
        invite_id: ctx.inviteId,
        participant_id: ctx.participantId,
        filename: outcome.row.original_filename,
        byte_size: Number(outcome.row.byte_size),
        sha256: outcome.row.sha256,
      },
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error({ event: "portal_evidence_delete_failed", err }, "Portal attachment withdrawal failed");
    res.status(500).json({ error: "portal_unavailable" });
  }
}

/* =========================================================
   GET /api/vendor-portal/comments — the clarification thread.

   `visibility = 'vendor'` is filtered IN SQL, not in the mapper. An internal
   reviewer's private note about this vendor must never enter the result set in
   the first place — a filter applied after the rows are in memory is one
   refactor away from being dropped.
   ========================================================= */
export async function getPortalComments(req: PortalRequest, res: Response): Promise<void> {
  const ctx = req.portalContext!;
  try {
    const result = await withTenant(ctx.organizationId, () =>
      pg.query<{
        id: string;
        author_type: string;
        author_display_name: string | null;
        body: string;
        requirement_id: string | null;
        reference_id: string | null;
        created_at: string;
      }>(
        `SELECT c.id, c.author_type, c.author_display_name, c.body,
                c.requirement_id, r.reference_id, c.created_at
           FROM vendor_engagement_comments c
           LEFT JOIN requirements r ON r.id = c.requirement_id
          WHERE c.organization_id = $1
            AND c.engagement_id   = $2
            AND c.visibility      = 'vendor'
          ORDER BY c.created_at ASC`,
        [ctx.organizationId, ctx.engagementId]
      )
    );

    const state = await withTenant(ctx.organizationId, () =>
      portalWriteWindow(ctx.organizationId, ctx.engagementId)
    );

    res.status(200).json({
      messages: result.rows.map((row) => ({
        id: row.id,
        // "you" / "reviewer" rather than a name. Internal reviewer identities are
        // not the vendor's business, and author_display_name is only ever set to
        // something the org chose to disclose.
        from: row.author_type === "vendor" ? "you" : "reviewer",
        author_name: row.author_display_name,
        body: row.body,
        requirement_id: row.requirement_id,
        requirement_reference: row.reference_id,
        sent_at: row.created_at,
      })),
      accepting_messages: state ? isPortalCommentable(state.state) : false,
    });
  } catch (err) {
    logger.error({ event: "portal_comments_read_failed", err }, "Portal comment read failed");
    res.status(500).json({ error: "portal_unavailable" });
  }
}

/* =========================================================
   POST /api/vendor-portal/comments — send a message.

   Note this does NOT resume from `clarification_requested`. Saying "we're
   looking into it" is not answering; the transition belongs to a real change to
   the submission.
   ========================================================= */
export async function postPortalComment(req: PortalRequest, res: Response): Promise<void> {
  const ctx = req.portalContext!;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const requirementId =
    typeof body.requirement_id === "string" && body.requirement_id.trim().length > 0
      ? body.requirement_id.trim()
      : null;

  try {
    const outcome = await withTenant(ctx.organizationId, async () => {
      const win = await portalWriteWindow(ctx.organizationId, ctx.engagementId);
      if (!win) return { code: 401 as const };
      if (!isPortalCommentable(win.state)) return { code: 409 as const };

      if (requirementId) {
        const inScope = await pg.query(
          `SELECT 1 FROM vendor_engagement_scope_items
            WHERE engagement_id = $1 AND organization_id = $2 AND requirement_id = $3
              AND (source = 'deterministic' OR accepted_at IS NOT NULL)
            LIMIT 1`,
          [ctx.engagementId, ctx.organizationId, requirementId]
        );
        if ((inScope.rowCount ?? 0) === 0) return { code: 404 as const };
      }

      const existing = await pg.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM vendor_engagement_comments
          WHERE organization_id = $1 AND engagement_id = $2`,
        [ctx.organizationId, ctx.engagementId]
      );
      const check = validateComment({
        body: body.body,
        existingCount: Number(existing.rows[0]?.n ?? "0"),
      });
      if (!check.ok) return { code: 400 as const, check };

      const ins = await pg.query<{ id: string }>(
        // visibility is pinned to 'vendor' HERE, not taken from the body. A
        // vendor cannot author an internal-only note, and the table's CHECK
        // rejects the row even if this line is ever changed carelessly.
        `INSERT INTO vendor_engagement_comments
           (organization_id, engagement_id, requirement_id, author_type,
            authored_via_invite_id, visibility, body)
         VALUES ($1, $2, $3, 'vendor', $4, 'vendor', $5)
         RETURNING id`,
        [ctx.organizationId, ctx.engagementId, requirementId, ctx.inviteId, check.body]
      );
      return { code: 201 as const, id: ins.rows[0]!.id };
    });

    if (outcome.code === 401) return invalidLink(res);
    if (outcome.code === 409) {
      res.status(409).json({
        error: "thread_closed",
        message: "This conversation is closed. Please contact your reviewer directly.",
      });
      return;
    }
    if (outcome.code === 404) {
      res.status(404).json({ error: "question_not_found" });
      return;
    }
    if (outcome.code === 400) {
      res.status(400).json(outcome.check);
      return;
    }

    writeAuditEvent({
      organizationId: ctx.organizationId,
      eventType: "vendor_portal.comment.posted",
      resourceType: "vendor_engagement",
      resourceId: ctx.engagementId,
      // The body is NOT copied into the audit payload — the row is the record,
      // and duplicating third-party free text into the audit log spreads any
      // erasure obligation across two stores.
      payload: {
        comment_id: outcome.id,
        invite_id: ctx.inviteId,
        participant_id: ctx.participantId,
        requirement_id: requirementId,
      },
      ipAddress: req.ip ?? null,
    });

    res.status(201).json({ id: outcome.id });
  } catch (err) {
    logger.error({ event: "portal_comment_post_failed", err }, "Portal comment post failed");
    res.status(500).json({ error: "portal_unavailable" });
  }
}

// ---------------------------------------------------------------------------
// Multipart handling for the one upload route.
//
// A portal-specific multer instance rather than the internal route's: the two
// limits are the same today but are different DECISIONS, and lowering the
// external one must never require editing the internal one.
// ---------------------------------------------------------------------------

const portalUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PORTAL_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedUploadMime(file.mimetype)) {
      cb(new Error("unsupported_file_type"));
      return;
    }
    cb(null, true);
  },
});


/* =========================================================
   VA-P1 — THE VENDOR'S OWN TEAM.

   The supplier, not the customer, knows who at the supplier should answer the
   privacy section. These three endpoints let their coordinator bring that
   person in without a round trip through the customer.

   Every one of them is bounded by the same fact: the org, the vendor and the
   engagement come from `req.portalContext`, which came from the session row.
   There is no request field anywhere below that can name a tenant, a vendor or
   an engagement — a coordinator cannot express "invite this person into
   somebody else's assessment", so it does not need to be forbidden.
   ========================================================= */

/** Only the coordinator manages the team; everyone else gets the same 403. */
function requireCoordinator(req: PortalRequest, res: Response): boolean {
  if (portalCanCoordinate(req)) return true;
  res.status(403).json({
    error: "not_coordinator",
    message: "Only the main contact for this assessment can manage who works on it.",
  });
  return false;
}

export async function getPortalParticipants(req: PortalRequest, res: Response): Promise<void> {
  const ctx = req.portalContext!;
  try {
    const participants = await withTenant(ctx.organizationId, () =>
      listParticipants(ctx.organizationId, ctx.engagementId)
    );
    res.status(200).json({
      // The vendor sees their own team, and never a customer-side user id:
      // invited_by_user_id would leak which person at the CUSTOMER added them.
      participants: participants.map((p) => ({
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        title: p.title,
        participant_role: p.participant_role,
        status: p.status,
        first_accepted_at: p.first_accepted_at,
        last_accepted_at: p.last_accepted_at,
        revoked_at: p.revoked_at,
        created_at: p.created_at,
        is_you: p.id === ctx.participantId,
        invited_by_teammate: p.invited_by_participant_id !== null,
        has_live_invite: p.invite_id !== null,
        invite_expires_at: p.invite_expires_at,
      })),
      you: {
        participant_id: ctx.participantId,
        can_manage_team: portalCanCoordinate(req),
      },
    });
  } catch (err) {
    logger.error(
      { event: "portal_participants_list_failed", engagementId: ctx.engagementId, err },
      "Portal participant list failed"
    );
    res.status(500).json({ error: "portal_participants_list_failed" });
  }
}

/**
 * The coordinator brings a teammate in.
 *
 * Two ways, and the second is the one that needed a decision. Naming an
 * EXISTING directory contact is obviously fine. Creating a new one is a write
 * into the customer's vendor directory performed by an external party — so it
 * is bounded hard: the contact can only ever be created against THIS session's
 * vendor (`ctx` again, never input), it is created with the default
 * 'contributor'-shaped role and never as the directory's primary contact, and
 * the audit records that a vendor coordinator — not a customer user — created
 * it. Refusing outright would have been the other defensible answer, but it
 * would make the common case ("my colleague isn't in your list") a dead end
 * that requires an email to the customer, which is the friction VA-P1 exists
 * to remove.
 */
export async function postPortalParticipant(req: PortalRequest, res: Response): Promise<void> {
  const ctx = req.portalContext!;
  if (!requireCoordinator(req, res)) return;

  // A legacy session (pre-VA-P1 invite, no participant row) may coordinate and
  // submit — it is the sole recipient — but it cannot ADD anyone, because the
  // table's one-inviter CHECK requires a real inviter and forging one would put
  // an unattributable participant on the engagement. That is the whole defect
  // VA-P1 exists to close, so it is refused with an explanation rather than
  // worked around.
  if (!ctx.participantId) {
    res.status(409).json({
      error: "legacy_invite_cannot_invite",
      message:
        "This link predates team access. Ask your contact to re-send the assessment, then you can add colleagues.",
    });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const contactIdInput = typeof body.contact_id === "string" ? body.contact_id.trim() : "";
  const fullName = typeof body.full_name === "string" ? body.full_name.trim().slice(0, 200) : "";
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 320) : "";
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) || null : null;

  if (!contactIdInput && (!fullName || !PORTAL_EMAIL_RE.test(email))) {
    res.status(400).json({
      error: "contact_required",
      message: "Choose someone from the list, or give a name and a valid email address.",
    });
    return;
  }

  try {
    const outcome = await withTenant(ctx.organizationId, async () => {
      // The engagement must still be open for vendor work. Adding a teammate to
      // a submitted questionnaire would mint a live credential for a document
      // nobody may change — an access grant with nothing behind it.
      const eng = await pg.query<{ status: string; vendor_id: string }>(
        `SELECT status, vendor_id FROM vendor_engagements
          WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [ctx.engagementId, ctx.organizationId]
      );
      const row = eng.rows[0];
      if (!row) return { code: 401 as const };
      if (!isPortalRespondable(row.status as EngagementState)) {
        return { code: 409 as const, state: row.status };
      }

      let contactId = contactIdInput;

      if (contactId) {
        // Must be a contact at THIS session's vendor. Same-org, different
        // supplier is the case org scoping cannot catch, so vendor_id carries
        // the whole check.
        const known = await pg.query<{ id: string; status: string }>(
          `SELECT id, status FROM vendor_contacts
            WHERE id = $1 AND organization_id = $2 AND vendor_id = $3 LIMIT 1`,
          [contactId, ctx.organizationId, row.vendor_id]
        );
        if (known.rowCount === 0) return { code: 404 as const };
        if (known.rows[0]!.status !== "active") return { code: 409 as const, contactInactive: true };
      } else {
        // Create the person, bounded to this vendor. ON CONFLICT resolves the
        // race and the "they're already in your directory" case to the same
        // place: the existing row, never a duplicate identity.
        const created = await pg.query<{ id: string; status: string }>(
          `INSERT INTO vendor_contacts
             (organization_id, vendor_id, full_name, email, title, contact_role)
           VALUES ($1, $2, $3, $4, $5, 'other')
           ON CONFLICT (organization_id, vendor_id, lower(email))
           DO UPDATE SET updated_at = NOW()
           RETURNING id, status`,
          [ctx.organizationId, row.vendor_id, fullName, email, title]
        );
        if (created.rows[0]!.status !== "active") return { code: 409 as const, contactInactive: true };
        contactId = created.rows[0]!.id;
      }

      const added = await addParticipant({
        organizationId: ctx.organizationId,
        engagementId: ctx.engagementId,
        contactId,
        role: "contributor",
        // Attributed to the PERSON who did it.
        invitedBy: { participantId: ctx.participantId! },
      });
      return { code: 201 as const, added, contactId };
    });

    if (outcome.code === 401) {
      invalidLink(res);
      return;
    }
    if (outcome.code === 404) {
      res.status(404).json({ error: "contact_not_found" });
      return;
    }
    if (outcome.code === 409) {
      res.status(409).json({
        error: outcome.contactInactive ? "contact_inactive" : "questionnaire_closed",
        message: outcome.contactInactive
          ? "That person is marked inactive. Ask your contact to reactivate them."
          : "This questionnaire is no longer open, so a new invitation would have nothing to do.",
      });
      return;
    }
    if (!outcome.added.ok) {
      res.status(409).json({ error: outcome.added.failure });
      return;
    }

    const result = outcome.added;

    // Delivery. Dark behind the VA-L1 flag exactly like the customer-side send
    // site; when it is off the coordinator gets the link once, on screen, and
    // passes it on themselves — the same honest fallback the customer has.
    const orgName = await withTenant(ctx.organizationId, () =>
      pg.query<{ name: string }>(`SELECT name FROM organizations WHERE id = $1`, [
        ctx.organizationId,
      ])
    );
    const delivery = await sendVendorInviteEmail({
      contactEmail: result.contactEmail,
      contactName: result.contactName,
      organizationName: orgName.rows[0]?.name ?? "Your customer",
      rawToken: result.inviteToken,
      expiresAt: result.expiresAt,
    });

    writeAuditEvent({
      organizationId: ctx.organizationId,
      eventType: "vendor_portal.participant_invited",
      resourceType: "vendor_engagement",
      resourceId: ctx.engagementId,
      // Never the token. The invite id is provenance; the token is a credential.
      payload: {
        participant_id: result.participant.id,
        contact_id: result.participant.contact_id,
        invite_id: result.inviteId,
        invited_by_participant_id: ctx.participantId,
        reused_participant: result.reused,
        email_delivery: delivery,
      },
      ipAddress: req.ip ?? null,
    });

    res.status(201).json({
      participant_id: result.participant.id,
      reused: result.reused,
      // Shown ONCE, never stored, never re-readable — the same contract the
      // customer-side issue response has.
      invite_token: result.inviteToken,
      expires_at: result.expiresAt.toISOString(),
      email_delivery: delivery,
    });
  } catch (err) {
    logger.error(
      { event: "portal_participant_invite_failed", engagementId: ctx.engagementId, err },
      "Portal participant invite failed"
    );
    res.status(500).json({ error: "portal_participant_invite_failed" });
  }
}

/**
 * The coordinator removes a teammate.
 *
 * Access ends; history stays. Their answers, revisions, files, comments and
 * audit rows are untouched and still carry their name — the ratified ruling,
 * applied literally. A coordinator cannot revoke themselves: it would leave the
 * engagement with nobody able to submit and no way back in from the vendor side.
 */
export async function revokePortalParticipant(req: PortalRequest, res: Response): Promise<void> {
  const ctx = req.portalContext!;
  if (!requireCoordinator(req, res)) return;

  if (!ctx.participantId) {
    res.status(409).json({
      error: "legacy_invite_cannot_invite",
      message: "This link predates team access. Ask your contact to re-send the assessment.",
    });
    return;
  }

  const participantId = String(req.params["participantId"] ?? "").trim();
  const body = (req.body ?? {}) as Record<string, unknown>;
  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, 500)
      : "removed by vendor coordinator";

  if (participantId === ctx.participantId) {
    res.status(409).json({
      error: "cannot_revoke_self",
      message: "You cannot remove yourself. Ask your contact to change the main contact first.",
    });
    return;
  }

  try {
    const outcome = await withTenant(ctx.organizationId, async () => {
      // Scoped to THIS engagement, so a participant id from another engagement
      // — including another engagement at the same vendor — is simply absent.
      const target = await resolveParticipant(ctx.organizationId, ctx.engagementId, participantId);
      if (!target) return { code: 404 as const };
      if (target.status === "revoked") return { code: 200 as const, killed: { invites: 0, sessions: 0 } };

      const killed = await revokeParticipant({
        organizationId: ctx.organizationId,
        participantId,
        reason,
        revokedBy: { participantId: ctx.participantId! },
      });
      return { code: 200 as const, killed };
    });

    if (outcome.code === 404) {
      res.status(404).json({ error: "participant_not_found" });
      return;
    }

    writeAuditEvent({
      organizationId: ctx.organizationId,
      eventType: "vendor_portal.participant_revoked",
      resourceType: "vendor_engagement",
      resourceId: ctx.engagementId,
      payload: {
        participant_id: participantId,
        revoked_by_participant_id: ctx.participantId,
        invites_revoked: outcome.killed.invites,
        sessions_revoked: outcome.killed.sessions,
        reason,
      },
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({ ok: true, ...outcome.killed });
  } catch (err) {
    logger.error(
      { event: "portal_participant_revoke_failed", engagementId: ctx.engagementId, err },
      "Portal participant revoke failed"
    );
    res.status(500).json({ error: "portal_participant_revoke_failed" });
  }
}

/** Translate multer's errors into JSON — the default handler emits HTML. */
function runPortalUpload(req: Request, res: Response, next: () => void): void {
  portalUpload.single("file")(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: "file_too_large",
          detail: `Max ${Math.floor(MAX_PORTAL_FILE_BYTES / (1024 * 1024))} MB`,
        });
        return;
      }
      res.status(400).json({ error: "upload_error", detail: err.code });
      return;
    }
    if ((err as Error)?.message === "unsupported_file_type") {
      res.status(415).json({
        error: "unsupported_file_type",
        detail: `Allowed: ${ALLOWED_UPLOAD_LABELS.join(", ")}`,
      });
      return;
    }
    res.status(400).json({ error: "upload_error" });
  });
}

// ---------------------------------------------------------------------------
// Router wiring
//
// The flag is FIRST on every route: off means 404 before any handler, any DB
// read, and — on the exchange route — before any token is even hashed.
// ---------------------------------------------------------------------------

// The limiter sits between the flag and the handler: a disabled portal still
// 404s before any counting, and an enabled one counts before any token is
// hashed or any invite row is read. See portalExchangeRateLimiter.ts for what
// it does and does not defend against.
router.post(
  "/vendor-portal/session",
  vendorPortalFeatureFlag,
  portalExchangeRateLimiter,
  exchangeInviteForSession
);

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

// VA-P1 — the vendor's own team. Coordinator-gated inside the handlers rather
// than by a middleware, because the list is readable by every participant and
// only the writes are restricted.
router.get(
  "/vendor-portal/participants",
  vendorPortalFeatureFlag,
  requirePortalSession,
  getPortalParticipants
);

router.post(
  "/vendor-portal/participants",
  vendorPortalFeatureFlag,
  requirePortalSession,
  postPortalParticipant
);

router.post(
  "/vendor-portal/participants/:participantId/revoke",
  vendorPortalFeatureFlag,
  requirePortalSession,
  revokePortalParticipant
);

// The session check runs BEFORE multer. An anonymous caller must not be able to
// make the process buffer 25 MB into memory per request just by posting to a
// public path — the credential check is the cheap gate and belongs first.
router.post(
  "/vendor-portal/evidence",
  vendorPortalFeatureFlag,
  requirePortalSession,
  runPortalUpload,
  uploadPortalEvidence
);

router.get(
  "/vendor-portal/evidence",
  vendorPortalFeatureFlag,
  requirePortalSession,
  listPortalEvidence
);

router.delete(
  "/vendor-portal/evidence/:evidenceId",
  vendorPortalFeatureFlag,
  requirePortalSession,
  deletePortalEvidence
);

router.get(
  "/vendor-portal/comments",
  vendorPortalFeatureFlag,
  requirePortalSession,
  getPortalComments
);

router.post(
  "/vendor-portal/comments",
  vendorPortalFeatureFlag,
  requirePortalSession,
  postPortalComment
);

export default router;
