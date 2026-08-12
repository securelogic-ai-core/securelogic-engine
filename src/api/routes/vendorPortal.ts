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
import { isPortalWritable, type EngagementState } from "../lib/vendorRisk/engagementStateMachine.js";

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

export default router;
