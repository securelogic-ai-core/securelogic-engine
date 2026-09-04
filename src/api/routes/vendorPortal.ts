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
import {
  asEvidencePolicy,
  evidenceRequired,
  explanationRequired,
  incompleteItems,
  isResponseAnswer,
  summarizeIncomplete,
  RESPONSE_ANSWERS,
  type CompletenessItem,
} from "../lib/vendorPortal/responseCompleteness.js";

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
        // The due date the vendor sees is the one the customer asked for on
        // THIS invitation (goal §B), falling back to the review cadence.
        `SELECT e.status, e.title,
                v.name  AS vendor_name,
                o.name  AS org_name,
                COALESCE(i.due_date::text, e.next_review_due::text) AS next_review_due
           FROM vendor_engagements e
           JOIN vendors       v ON v.id = e.vendor_id
           JOIN organizations o ON o.id = e.organization_id
           LEFT JOIN vendor_engagement_invites i
                  ON i.id = $3 AND i.organization_id = e.organization_id
          WHERE e.id = $1 AND e.organization_id = $2
          LIMIT 1`,
        [ctx.engagementId, ctx.organizationId, ctx.inviteId]
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

   WA-1: also carries the COMPLETENESS contract per item — the question's
   evidence policy, how many artifacts are attached to it, and the two derived
   booleans the submit gate will apply. The vendor's UI must be able to show
   "an explanation is required here" BEFORE they reach the submit refusal, and
   it must derive that from the same module the engine refuses with
   (responseCompleteness.ts) rather than reimplementing the rule in TypeScript
   on the other side of the wire.
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
        evidence_policy: string | null;
        evidence_count: string;
      }>(
        // Only ASKABLE items: deterministic ones, plus AI-suggested ones a human
        // accepted. An unaccepted suggestion must never reach a vendor — that is
        // the ratified AI boundary.
        `SELECT si.requirement_id, r.reference_id,
                COALESCE(qv.prompt, r.title) AS title,
                COALESCE(qv.guidance, r.description) AS description,
                si.depth, si.mandatory, si.reasons,
                rr.status, rr.notes,
                qv.evidence_policy,
                -- Artifacts the vendor has attached TO THIS QUESTION. The same
                -- predicate listPortalEvidence uses, so the count beside a
                -- question and the file on the library page are one fact.
                COUNT(ev.id)::text AS evidence_count
           FROM vendor_engagement_scope_items si
           JOIN requirements r ON r.id = si.requirement_id
           -- VA-Q1 P2 (ADR-0013 R3): the vendor reads the IMMUTABLE version the
           -- scope item was frozen against, so a later requirement edit cannot
           -- change the question mid-assessment. Pre-P2 rows fall back.
           LEFT JOIN question_versions qv
                  ON qv.id = si.question_version_id
                 AND qv.organization_id = si.organization_id
           LEFT JOIN requirement_responses rr
                  ON rr.requirement_id = si.requirement_id
                 AND rr.engagement_id  = si.engagement_id
                 AND rr.organization_id = si.organization_id
           LEFT JOIN evidence ev
                  ON ev.engagement_id   = si.engagement_id
                 AND ev.requirement_id  = si.requirement_id
                 AND ev.organization_id = si.organization_id
                 AND ev.detached_at IS NULL
                 AND ev.storage_key IS NOT NULL
          WHERE si.engagement_id = $1
            AND si.organization_id = $2
            AND (si.source = 'deterministic' OR si.accepted_at IS NOT NULL)
          GROUP BY si.requirement_id, r.reference_id, qv.prompt, r.title,
                   qv.guidance, r.description, si.depth, si.mandatory, si.reasons,
                   rr.status, rr.notes, qv.evidence_policy
          ORDER BY r.reference_id ASC`,
        [ctx.engagementId, ctx.organizationId]
      )
    );

    res.status(200).json({
      questions: result.rows.map((row) => {
        const policy = asEvidencePolicy(row.evidence_policy);
        const answer = isResponseAnswer(row.status) ? row.status : null;
        return {
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
          // WA-1 completeness contract. `*_required` are NULL until the vendor
          // has answered — the requirement is a property of the answer, and
          // asserting one before there is an answer would light the whole form
          // up red on first open.
          evidence_policy: policy,
          evidence_count: Number(row.evidence_count),
          explanation_required: answer === null ? null : explanationRequired(answer, policy),
          evidence_required: answer === null ? null : evidenceRequired(answer, policy),
        };
      }),
    });
  } catch (err) {
    logger.error({ event: "portal_questions_read_failed", err }, "Portal questions read failed");
    res.status(500).json({ error: "portal_unavailable" });
  }
}

/**
 * The structured answer vocabulary. Required — see the effectiveness ladder.
 *
 * Taken from responseCompleteness.ts rather than re-listed here: the module
 * that decides whether an answer needs an explanation and the route that
 * decides whether an answer is valid must not be able to disagree about what
 * the answers ARE.
 */
const PORTAL_ANSWERS = new Set<string>(RESPONSE_ANSWERS);

/**
 * How many incomplete items the submit refusal names individually. The counts
 * are always exact; only the list is capped, and `items_truncated` says so.
 */
const INCOMPLETE_ITEMS_CAP = 50;

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
      const inScope = await pg.query<{ question_version_id: string | null }>(
        `SELECT question_version_id FROM vendor_engagement_scope_items
          WHERE engagement_id = $1 AND organization_id = $2 AND requirement_id = $3
            AND (source = 'deterministic' OR accepted_at IS NOT NULL)
          LIMIT 1`,
        [ctx.engagementId, ctx.organizationId, requirementId]
      );
      if ((inScope.rowCount ?? 0) === 0) return { code: 404 as const };
      // VA-Q1 P2: the answer records WHICH content it answered. Taken from the
      // frozen scope item, never from the caller.
      const questionVersionId = inScope.rows[0]!.question_version_id;

      // subject_id is the ENGAGEMENT'S vendor, resolved server-side.
      const vendor = await pg.query<{ vendor_id: string }>(
        `SELECT vendor_id FROM vendor_engagements WHERE id = $1 AND organization_id = $2`,
        [ctx.engagementId, ctx.organizationId]
      );
      const vendorId = vendor.rows[0]!.vendor_id;

      const saved = await pg.query<{ id: string }>(
        `INSERT INTO requirement_responses
           (organization_id, requirement_id, assessment_type, subject_id, engagement_id,
            responder_type, answered_via_invite_id, status, notes, assessed_at, question_version_id)
         VALUES ($1, $2, 'vendor', $3, $4, 'vendor', $5, $6, $7, NOW(), $8)
         ON CONFLICT (organization_id, requirement_id, assessment_type, subject_id,
                      COALESCE(engagement_id, '00000000-0000-0000-0000-000000000000'::uuid))
         DO UPDATE SET status = EXCLUDED.status,
                       notes = EXCLUDED.notes,
                       responder_type = EXCLUDED.responder_type,
                       answered_via_invite_id = EXCLUDED.answered_via_invite_id,
                       question_version_id = COALESCE(EXCLUDED.question_version_id, requirement_responses.question_version_id),
                       assessed_at = NOW(),
                       updated_at = NOW()
         RETURNING id`,
        [ctx.organizationId, requirementId, vendorId, ctx.engagementId, ctx.inviteId, status, notes, questionVersionId]
      );

      // Append-only history. The upsert above cannot answer "what did they say
      // before they changed it"; this can.
      await pg.query(
        `INSERT INTO requirement_response_revisions
           (organization_id, response_id, status, notes, responder_type, answered_via_invite_id,
            question_version_id)
         VALUES ($1, $2, $3, $4, 'vendor', $5, $6)`,
        [ctx.organizationId, saved.rows[0]!.id, status, notes, ctx.inviteId, questionVersionId]
      );

      // Answering during a clarification is what reopens the engagement —
      // the state machine's clarification_requested -> in_progress transition.
      await resumeFromClarification(ctx.organizationId, ctx.engagementId, state);

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
      // #949: LOCK the engagement row for the rest of this transaction. Submit
      // is a check-then-act — read the status, decide, then write conditionally
      // on that same status — and without the lock a concurrent submit (a
      // double-click is enough) can commit the transition in between, leaving
      // the second UPDATE matching zero rows. The lock is the mechanism; the
      // rowCount assertion below is the backstop, not the control.
      const eng = await pg.query<{ status: string }>(
        `SELECT status FROM vendor_engagements
          WHERE id = $1 AND organization_id = $2 LIMIT 1 FOR UPDATE`,
        [ctx.engagementId, ctx.organizationId]
      );
      const from = eng.rows[0]?.status as EngagementState | undefined;
      if (!from) return { code: 401 as const };

      // The state machine decides legality — including that a portal actor may
      // cause this transition at all. Handlers never hand-roll a status check.
      const check = canTransition(from, "submitted", "portal");
      if (!check.allowed) return { code: 409 as const, from, reason: check.reason };

      // Guard `all_mandatory_answered`, declared on the transition — WIDENED by
      // WA-1 (owner ruling 3) into the full completeness rule.
      //
      // The shipped guard counted unanswered mandatory items and nothing else,
      // which is how the owner's walkthrough submitted 5 `partial` and 3 `fail`
      // answers with no explanation on any of them. The decision about what
      // blocks a submission now lives in ONE pure module
      // (responseCompleteness.ts) that this guard and the read surface the
      // vendor's UI renders from both call; the SQL below only supplies facts.
      //
      // Same scope predicate as `/questions` and recompute — deterministic OR
      // accepted — so the gate can never demand an explanation for an item the
      // vendor was never shown.
      const scope = await pg.query<{
        requirement_id: string;
        reference_id: string;
        mandatory: boolean;
        status: string | null;
        notes: string | null;
        evidence_policy: string | null;
        evidence_count: string;
      }>(
        `SELECT si.requirement_id, r.reference_id, si.mandatory,
                rr.status, rr.notes, qv.evidence_policy,
                COUNT(ev.id)::text AS evidence_count
           FROM vendor_engagement_scope_items si
           JOIN requirements r ON r.id = si.requirement_id
           LEFT JOIN question_versions qv
                  ON qv.id = si.question_version_id
                 AND qv.organization_id = si.organization_id
           LEFT JOIN requirement_responses rr
                  ON rr.requirement_id = si.requirement_id
                 AND rr.engagement_id  = si.engagement_id
                 AND rr.organization_id = si.organization_id
           LEFT JOIN evidence ev
                  ON ev.engagement_id   = si.engagement_id
                 AND ev.requirement_id  = si.requirement_id
                 AND ev.organization_id = si.organization_id
                 AND ev.detached_at IS NULL
                 AND ev.storage_key IS NOT NULL
          WHERE si.engagement_id = $1 AND si.organization_id = $2
            AND (si.source = 'deterministic' OR si.accepted_at IS NOT NULL)
          GROUP BY si.requirement_id, r.reference_id, si.mandatory,
                   rr.status, rr.notes, qv.evidence_policy
          ORDER BY r.reference_id ASC`,
        [ctx.engagementId, ctx.organizationId]
      );
      const items: CompletenessItem[] = scope.rows.map((row) => ({
        requirement_id: row.requirement_id,
        reference: row.reference_id,
        mandatory: row.mandatory,
        answer: row.status,
        notes: row.notes,
        evidence_policy: asEvidencePolicy(row.evidence_policy),
        evidence_count: Number(row.evidence_count),
      }));
      const incomplete = incompleteItems(items);
      if (incomplete.length > 0) return { code: 422 as const, incomplete };

      // #949: THE TRANSITION IS VERIFIED. This UPDATE is conditional on the
      // status we read, and its rowCount used to be discarded — so a zero-row
      // transition still returned 200 and the vendor was told their
      // questionnaire had been submitted when it had not, with a
      // `vendor_portal.submitted` audit event to match. Nothing downstream runs
      // unless exactly one row moved.
      const moved = await pg.query(
        `UPDATE vendor_engagements
            SET status = 'submitted', submitted_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND organization_id = $2 AND status = $3`,
        [ctx.engagementId, ctx.organizationId, from]
      );
      if (moved.rowCount !== 1) {
        // Unreachable while the FOR UPDATE lock holds. Kept as an assertion: if
        // it fires, the state moved under a lock we believed we held, and
        // answering 200 would tell a vendor their obligation is discharged when
        // the authoritative record says otherwise.
        logger.error(
          {
            event: "portal_submit_transition_lost",
            organizationId: ctx.organizationId,
            engagementId: ctx.engagementId,
            from,
            rowCount: moved.rowCount,
          },
          "Submit transition matched no row while holding FOR UPDATE"
        );
        return { code: 409 as const, conflict: true as const };
      }
      return { code: 200 as const };
    });

    if (outcome.code === 401) {
      invalidLink(res);
      return;
    }
    if (outcome.code === 409) {
      // Two distinguishable refusals. `cannot_submit` is the ordinary one — the
      // state machine says a portal actor may not make this transition from
      // here. `submit_conflict` means the engagement moved while this
      // submission was being prepared; the vendor's answers are intact and
      // re-submitting is the right next step, so the message says so.
      const conflict = "conflict" in outcome && outcome.conflict === true;
      res.status(409).json({
        error: conflict ? "submit_conflict" : "cannot_submit",
        message: conflict
          ? "This questionnaire changed while your submission was being recorded. Nothing was lost — please try again."
          : "This questionnaire is not currently open for submission.",
      });
      return;
    }
    if (outcome.code === 422) {
      // ADDITIVE refusal shape. `error` and `unanswered_required` keep their
      // shipped meaning so an existing client that reads only those two keys
      // behaves exactly as before; the new keys name the rest. The per-item
      // list is capped because a vendor with 200 unstarted questions needs a
      // number and a place to start, not 200 lines of JSON.
      const counts = summarizeIncomplete(outcome.incomplete);
      const parts: string[] = [];
      if (counts.unanswered_required > 0) {
        parts.push(`${counts.unanswered_required} required question(s) still need an answer`);
      }
      if (counts.explanations_missing > 0) {
        parts.push(
          `${counts.explanations_missing} answer(s) need an explanation — "Partially in place", "Not in place" and "Not applicable" must say why`
        );
      }
      if (counts.evidence_missing > 0) {
        parts.push(`${counts.evidence_missing} answer(s) need supporting evidence attached`);
      }
      res.status(422).json({
        error: "incomplete",
        unanswered_required: counts.unanswered_required,
        explanations_missing: counts.explanations_missing,
        evidence_missing: counts.evidence_missing,
        items: outcome.incomplete.slice(0, INCOMPLETE_ITEMS_CAP),
        items_truncated: outcome.incomplete.length > INCOMPLETE_ITEMS_CAP,
        message: `${parts.join("; ")}.`,
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

      // VA-S4: an artifact that is IN USE is not the vendor's to destroy.
      //
      // 20261081 made evidence_links.evidence_id ON DELETE RESTRICT, so once a
      // reviewer has linked this file the DELETE below would fail on the
      // constraint and surface as a 500. Refuse first, with a reason.
      //
      // This is also an authorization boundary, not just an error-shape fix. A
      // vendor able to delete evidence a reviewer already confirmed could
      // remove inconvenient proof after the fact. Destroying a linked artifact
      // is a governed WITHDRAWAL (owner ruling 2026-09-01) performed by an
      // attributed reviewer in the OWNING organization — POST
      // /api/evidence/:id/withdraw — never by the vendor.
      //
      // Today this changes nothing: no links exist estate-wide. It is
      // fail-closed from the moment linking starts.
      const inUse = await pg.query(
        `SELECT 1 FROM evidence_links
          WHERE evidence_id = $1 AND organization_id = $2 LIMIT 1`,
        [evidenceId, ctx.organizationId]
      );
      if ((inUse.rowCount ?? 0) > 0) return { code: 423 as const };

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
    // A DIFFERENT refusal from "responses closed", and it must say so. Two 409s
    // that render the same message is the defect family this codebase has hit
    // three times: a check that proves something by observing a refusal has to
    // pin down WHY the refusal happened.
    if (outcome.code === 423) {
      res.status(409).json({
        error: "evidence_in_use",
        message:
          "This file has been used as evidence in a review and can no longer be " +
          "removed here. Ask your contact at the reviewing organization to withdraw it.",
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
