/**
 * requirePortalSession.ts — authentication for the EXTERNAL vendor portal.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS THE ONLY PLACE AN UNAUTHENTICATED CALLER BECOMES A PRINCIPAL.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Everything about the portal's safety flows from three properties of this file:
 *
 *  1. The org and engagement come from the SESSION ROW, never from the request.
 *     There is no parameter, header or body field anywhere in the portal surface
 *     that can name a tenant, a user, or another engagement. A caller cannot
 *     express the thing we are protecting against.
 *
 *  2. Resolution happens on the ELEVATED channel, because it necessarily
 *     PRECEDES org context — the lookup is what establishes the org. This is the
 *     same shape the tokenized data-export download route already uses
 *     (dataExports.ts: hash-then-lookup on pgElevated, "there is no org context
 *     yet, so the tenant channel would see zero rows"). Everything AFTER
 *     resolution runs inside withTenant(orgId).
 *
 *  3. `req.portalContext` and `req.organizationContext` are STRUCTURALLY
 *     DISJOINT. A portal request never carries an organizationContext, so it
 *     cannot reach any normal API route; an API-key request never carries a
 *     portalContext, so it cannot reach a portal route. The two authentication
 *     worlds cannot be confused by a future refactor, because neither one's
 *     middleware will populate the other's field.
 *
 * ── Rate limiting is DB-backed on purpose ──────────────────────────────────
 *
 * apiRateLimiter.ts fails open when Redis is unavailable. That is a defensible
 * trade for authenticated API keys and an unacceptable one here: a Redis blip
 * would remove the only limit on a public endpoint. The counter lives on the
 * session row, so it survives a cache outage.
 */

import type { NextFunction, Request, Response } from "express";

import { pgElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import {
  PORTAL_SESSION_COOKIE,
  checkSessionValidity,
  hashPortalToken,
  slideIdleWindow,
} from "../lib/vendorPortal/portalTokens.js";

/** Requests per minute per session. Enforced in the database. */
export const PORTAL_RATE_LIMIT_PER_MINUTE = 120;
const RATE_WINDOW_MS = 60_000;

/**
 * What a portal request carries. Note the absence of anything the CALLER
 * supplied: every field is resolved from the session row.
 */
export type PortalContext = {
  sessionId: string;
  inviteId: string;
  organizationId: string;
  engagementId: string;
  /**
   * VA-P1. The PERSON behind this session, resolved from the invite's
   * participant record — never from the request, like everything else here.
   *
   * NULL for a session minted from a pre-VA-P1 invite (issued to a typed
   * address with no participation record). Such a session is treated as the
   * engagement's sole recipient — which is exactly what it was under the
   * single-recipient model — so old links keep working and keep their
   * submission authority. See `portalCanCoordinate`.
   */
  participantId: string | null;
  participantRole: "coordinator" | "contributor" | null;
  contactId: string | null;
};

export type PortalRequest = Request & { portalContext?: PortalContext };

type SessionRow = {
  id: string;
  invite_id: string;
  organization_id: string;
  engagement_id: string;
  idle_expires_at: string;
  absolute_expires_at: string;
  revoked_at: string | null;
  invite_revoked_at: string | null;
  request_count: number;
  window_started_at: string;
  created_user_agent_sha256: string | null;
  participant_id: string | null;
  participant_role: "coordinator" | "contributor" | null;
  participant_status: string | null;
  participant_contact_id: string | null;
};

/**
 * A single, uniform rejection.
 *
 * Absent, revoked, expired and malformed all produce the SAME response. An
 * expired invite is reported distinctly at the exchange endpoint — that is
 * actionable for a vendor and is not a useful oracle — but once we are talking
 * about a session cookie, distinguishing "revoked" from "never existed" would
 * tell an attacker whether a captured cookie was ever real.
 */
function reject(res: Response): void {
  res.status(401).json({ error: "portal_session_invalid" });
}

export async function requirePortalSession(
  req: PortalRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const raw = (req.cookies as Record<string, string> | undefined)?.[PORTAL_SESSION_COOKIE];
  if (typeof raw !== "string" || raw.length === 0) {
    reject(res);
    return;
  }

  try {
    const tokenHash = hashPortalToken(raw);

    // Elevated channel: this lookup PRECEDES org context — it is what
    // establishes it. The unique hash index resolves at most one row.
    // The invite is joined (PK lookup) rather than trusted to have been swept
    // by the revoke route. VA-L1's revoke kills the invite and then its live
    // sessions, which leaves one window: an exchange that read the invite
    // BEFORE the revocation committed can insert its session AFTER the sweep
    // ran, producing a live session for a dead invite. Re-reading the invite
    // here closes that window for every request, and makes invite revocation
    // authoritative for any future code path that mints a session.
    //
    // Invite EXPIRY is deliberately NOT enforced here: a session is bounded by
    // its own idle and absolute windows, and evicting a vendor mid-answer
    // because the weeks-long invite aged out would destroy work without making
    // anything safer. Revocation is a decision; expiry is a clock.
    const result = await pgElevated.query<SessionRow>(
      `SELECT s.id, s.invite_id, s.organization_id, s.engagement_id,
              s.idle_expires_at, s.absolute_expires_at, s.revoked_at,
              i.revoked_at AS invite_revoked_at,
              s.request_count, s.window_started_at, s.created_user_agent_sha256,
              p.id   AS participant_id,
              p.participant_role,
              p.status AS participant_status,
              p.contact_id AS participant_contact_id
         FROM vendor_portal_sessions s
         JOIN vendor_engagement_invites i ON i.id = s.invite_id
         LEFT JOIN vendor_engagement_participants p ON p.id = i.participant_id
        WHERE s.session_token_hash = $1
        LIMIT 1`,
      [tokenHash]
    );
    const session = result.rows[0] ?? null;

    const validity = checkSessionValidity(
      session
        ? {
            idleExpiresAt: session.idle_expires_at,
            absoluteExpiresAt: session.absolute_expires_at,
            // Any of the three kills the session. Revoking the invite revokes
            // everything minted from it — that is the ruling, not a
            // convenience. The PARTICIPANT arm (VA-P1) is belt-and-braces:
            // revokeParticipant already kills their invites, but this means a
            // participant revoked by any future path that forgets the invite
            // sweep still loses access on their very next request.
            revokedAt:
              session.revoked_at ??
              session.invite_revoked_at ??
              (session.participant_status === "revoked" ? new Date(0).toISOString() : null),
          }
        : null
    );
    if (!validity.valid || !session) {
      // Logged with the REASON for operators, while the caller gets a uniform 401.
      logger.info(
        { event: "portal_session_rejected", reason: validity.valid ? "unknown" : validity.reason },
        "Vendor-portal session rejected"
      );
      reject(res);
      return;
    }

    // ── DB-backed rate limit ────────────────────────────────────────────
    const now = Date.now();
    const windowStarted = new Date(session.window_started_at).getTime();
    const windowExpired = now - windowStarted >= RATE_WINDOW_MS;
    const nextCount = windowExpired ? 1 : session.request_count + 1;

    if (!windowExpired && nextCount > PORTAL_RATE_LIMIT_PER_MINUTE) {
      logger.warn(
        {
          event: "portal_rate_limited",
          sessionId: session.id,
          engagementId: session.engagement_id,
          count: session.request_count,
        },
        "Vendor-portal session rate limited"
      );
      res.status(429).json({
        error: "rate_limit_exceeded",
        message: "Too many requests. Please wait a moment and try again.",
      });
      return;
    }

    // Slide the idle window, never past the absolute bound, and record the
    // counter + fingerprint drift in one write.
    const slidIdle = slideIdleWindow(new Date(session.absolute_expires_at), new Date(now));
    const ip = req.ip ?? null;
    const fingerprintChanged =
      session.created_user_agent_sha256 !== null &&
      typeof req.headers["user-agent"] === "string" &&
      hashPortalToken(String(req.headers["user-agent"])) !== session.created_user_agent_sha256;

    await pgElevated.query(
      `UPDATE vendor_portal_sessions
          SET idle_expires_at = $2,
              last_seen_at = NOW(),
              last_seen_ip = $3,
              request_count = $4,
              window_started_at = CASE WHEN $5 THEN NOW() ELSE window_started_at END,
              fingerprint_changed_at = CASE WHEN $6 AND fingerprint_changed_at IS NULL
                                            THEN NOW() ELSE fingerprint_changed_at END
        WHERE id = $1`,
      [session.id, slidIdle, ip, nextCount, windowExpired, fingerprintChanged]
    );

    // Everything the handlers get comes from the ROW.
    req.portalContext = {
      sessionId: session.id,
      inviteId: session.invite_id,
      organizationId: session.organization_id,
      engagementId: session.engagement_id,
      participantId: session.participant_id,
      participantRole: session.participant_role,
      contactId: session.participant_contact_id,
    };

    // Belt and braces: a portal request must never carry an organizationContext,
    // because that is what every authenticated route reads. If one is somehow
    // present, strip it rather than letting the two worlds overlap.
    if ((req as Request & { organizationContext?: unknown }).organizationContext) {
      delete (req as Request & { organizationContext?: unknown }).organizationContext;
    }

    next();
  } catch (err) {
    logger.error({ event: "portal_session_resolution_failed", err }, "Portal session resolution failed");
    // Fail CLOSED. A resolver error must never fall through to a handler.
    reject(res);
  }
}

/**
 * Assert the caller is operating on THEIR OWN engagement.
 *
 * Handlers should not need this — they take the engagement from
 * `req.portalContext` and never from input — but it exists so that a future
 * handler which does accept an id has an obvious, single way to check it, rather
 * than each one inventing its own comparison.
 */
export function portalOwnsEngagement(req: PortalRequest, engagementId: string): boolean {
  return req.portalContext?.engagementId === engagementId;
}

/**
 * May this session act as the engagement's coordinator? (VA-P1)
 *
 * Two things are true at once and both must stay true:
 *
 *   - once an engagement has participants, only the COORDINATOR may invite a
 *     teammate, revoke one, or submit the questionnaire. A contributor who
 *     could submit could end everyone else's work mid-sentence;
 *   - a session minted from a pre-VA-P1 invite has no participant record. It is
 *     the sole recipient of a single-recipient engagement and always could
 *     submit, so it keeps that authority. Denying it would break every
 *     in-flight engagement the moment this ships.
 *
 * The second case is why this is a named predicate rather than an inline
 * `role === "coordinator"` at four call sites: the null is load-bearing and
 * easy to get wrong in one place out of four.
 */
export function portalCanCoordinate(req: PortalRequest): boolean {
  const ctx = req.portalContext;
  if (!ctx) return false;
  return ctx.participantId === null || ctx.participantRole === "coordinator";
}
