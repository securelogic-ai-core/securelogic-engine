/**
 * teamInvites.ts — Multi-user team management API
 *
 * Routes:
 *   POST   /api/team/invite                     — send invite (admin)
 *   GET    /api/team/members                    — list members + pending invites
 *   DELETE /api/team/members/:userId            — remove member (admin)
 *   PATCH  /api/team/members/:userId/role       — change member role (admin)
 *   DELETE /api/team/invites/:inviteId          — revoke invite (admin)
 *   GET    /api/team/invites/:token/preview     — preview invite (public)
 *   POST   /api/team/invites/:token/accept      — accept invite (public)
 */

import crypto from "crypto";
import { Router } from "express";
import argon2 from "argon2";
import rateLimit from "express-rate-limit";
import { Resend } from "resend";
import { pg } from "../infra/postgres.js";
import { asTenant } from "../middleware/asTenant.js";
import { rateLimitKeyGenerator } from "../infra/clientIp.js";
import { digestToken, isPresentableToken } from "../lib/tokenDigest.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireTeamCapability } from "../middleware/requireTeamCapability.js";
import { requireRole } from "../middleware/requireRole.js";
import { signJwt } from "../lib/jwt.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { recordAllCurrentConsents } from "../lib/legalConsent.js";
import { enforceSeatLimit, enforceSeatLimitForClass, type SeatClass } from "../lib/seatLimit.js";
import { seatModelEnabled } from "../middleware/requireSeat.js";
import { sendViaProvider, type ResendLike } from "../infra/emailTransport.js";

const router = Router();

const VALID_ROLES = new Set(["admin", "analyst", "viewer"]);
const VALID_SEAT_TYPES = new Set(["full", "contributor", "viewer"]);

/**
 * A seat sets the ceiling; an incompatible (seat, role) pair is rejected at
 * write time so stored state is always clean (resolveScope also clamps at read
 * time as a backstop). Only a Full seat may hold the admin role.
 */
function seatRoleCompatible(seatType: string, role: string): boolean {
  // Only a Full seat may hold admin.
  if (role === "admin" && seatType !== "full") return false;
  // A Viewer seat is read-only, so it may hold only the viewer role — pairing
  // it with a writing role is meaningless (resolveScope clamps it to viewer)
  // and must not be provisioned.
  if (seatType === "viewer" && role !== "viewer") return false;
  return true;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isValidEmail(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const t = v.trim();
  return t.length >= 3 && t.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

function validatePassword(v: unknown): { error: string; detail: string } | null {
  if (typeof v !== "string" || v.length < 12 || v.length > 128)
    return { error: "password_too_short", detail: "12 characters minimum" };
  if (!/[a-z]/.test(v) || !/[A-Z]/.test(v) || !/[0-9]/.test(v))
    return { error: "password_too_weak", detail: "Must include uppercase, lowercase, and a number" };
  return null;
}

function isValidName(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const t = v.trim();
  return t.length >= 1 && t.length <= 120;
}

function getAppBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "https://securelogic-app.onrender.com").replace(/\/$/, "");
}

function getFromAddress(): string {
  return process.env.NEWSLETTER_FROM_EMAIL?.trim() ?? "SecureLogic AI <noreply@securelogicai.com>";
}

function inviteEmailHtml(params: {
  inviterName: string;
  orgName: string;
  role: string;
  inviteUrl: string;
}): string {
  const { inviterName, orgName, role, inviteUrl } = params;
  const roleName = role.charAt(0).toUpperCase() + role.slice(1);
  const safe = (s: string) =>
    s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] ?? c));

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0f1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#0a0f1a">
  <tr><td align="center" style="padding:40px 16px;">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
      <tr><td align="center" style="padding-bottom:32px;">
        <span style="font-size:20px;font-weight:700;color:#00c4b4;letter-spacing:-0.5px;">SecureLogic AI</span>
      </td></tr>
      <tr><td style="background:#0d1b2e;border:1px solid #1e2d45;border-radius:12px;padding:40px;">
        <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f1f5f9;">You've been invited</p>
        <p style="margin:0 0 24px;font-size:15px;color:#94a3b8;">
          <strong style="color:#e2e8f0;">${safe(inviterName)}</strong> has invited you to join
          <strong style="color:#e2e8f0;">${safe(orgName)}</strong> on SecureLogic AI as
          <strong style="color:#e2e8f0;">${safe(roleName)}</strong>.
        </p>
        <p style="margin:0 0 24px;font-size:14px;color:#64748b;">
          Click the button below to accept your invitation and set up your account.
          This link expires in 7 days.
        </p>
        <table cellpadding="0" cellspacing="0"><tr><td>
          <a href="${inviteUrl}"
             style="display:inline-block;background:#00c4b4;color:#0a0f1a;font-size:15px;font-weight:600;text-decoration:none;padding:14px 28px;border-radius:8px;">
            Accept Invitation
          </a>
        </td></tr></table>
        <p style="margin:24px 0 0;font-size:13px;color:#64748b;">
          If you weren't expecting this invitation, you can safely ignore this email.
        </p>
      </td></tr>
      <tr><td align="center" style="padding:24px 0 0;">
        <p style="margin:0;font-size:12px;color:#334155;">© ${new Date().getFullYear()} SecureLogic AI. All rights reserved.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

async function sendInviteEmail(params: {
  to: string;
  inviterName: string;
  orgName: string;
  role: string;
  inviteUrl: string;
  /** Observability only — never rendered into the mail. */
  orgId?: string | null;
  inviteId?: string | null;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    logger.warn({ event: "invite_email_no_resend_key" }, "RESEND_API_KEY not set — invite email not sent");
    return;
  }
  const resend = new Resend(key);
  // EMAIL-OBS-1: through the shared choke point; a provider rejection now
  // THROWS into the caller's existing error handling instead of resolving as
  // if the invitation had gone out.
  const res = await sendViaProvider({
    client: resend as unknown as ResendLike,
    purpose: "team.invite",
    orgId: params.orgId ?? null,
    correlationId: params.inviteId ?? null,
    from: getFromAddress(),
    to: params.to,
    subject: `${params.inviterName} invited you to ${params.orgName} on SecureLogic AI`,
    html: inviteEmailHtml(params)
  });
  if (!res.ok) throw new Error(`invite_email_${res.outcome}: ${res.errorMessage}`);
}

/* =========================================================
   POST /api/team/invite
   Send a team invitation email.
   Requires: admin role + standard entitlement.
   ========================================================= */

const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: rateLimitKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limit_exceeded" }
});

router.post(
  "/team/invite",
  requireApiKey,
  attachOrganizationContext,
  requireTeamCapability(),
  requireRole("admin"),
  inviteLimiter,
  asTenant(async (req, res) => {
    try {
      const orgId  = (req as any).organizationContext?.organizationId as string | null;
      const userId = req.userId ?? null;

      if (!orgId || !userId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const body  = req.body as Record<string, unknown>;
      const email = isValidEmail(body.email) ? String(body.email).trim().toLowerCase() : null;
      const role  = typeof body.role === "string" && VALID_ROLES.has(body.role) ? body.role : "analyst";
      // Seat type carried on the invite (enterprise seat program). Defaults to
      // 'full' so behaviour is unchanged when the caller does not specify one.
      const seatType = typeof body.seat_type === "string" && VALID_SEAT_TYPES.has(body.seat_type)
        ? body.seat_type
        : "full";

      if (!seatRoleCompatible(seatType, role)) {
        res.status(400).json({ error: "incompatible_seat_role", detail: "Only a Full seat can hold the admin role." });
        return;
      }

      if (!email) {
        res.status(400).json({ error: "invalid_email" });
        return;
      }

      // Check seat limit
      const countResult = await pg.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM users
         WHERE organization_id = $1 AND status = 'active'`,
        [orgId]
      );
      const orgResult = await pg.query<{ max_members: number; name: string }>(
        `SELECT max_members, name FROM organizations WHERE id = $1 LIMIT 1`,
        [orgId]
      );

      const usedSeats = parseInt(countResult.rows[0]?.count ?? "0", 10);
      const maxSeats  = orgResult.rows[0]?.max_members ?? 6;
      const orgName   = orgResult.rows[0]?.name ?? "Your Organisation";

      if (usedSeats >= maxSeats) {
        res.status(409).json({
          error: "seat_limit_reached",
          detail: `Your plan allows up to ${maxSeats} members. Upgrade to add more.`
        });
        return;
      }

      // Check if already a member
      const existingUser = await pg.query(
        `SELECT id FROM users WHERE organization_id = $1 AND LOWER(email) = $2 AND status != 'inactive' LIMIT 1`,
        [orgId, email]
      );
      if (existingUser.rows.length > 0) {
        res.status(409).json({ error: "member_already_exists" });
        return;
      }

      // Get inviter name
      const inviterResult = await pg.query<{ name: string }>(
        `SELECT name FROM users WHERE id = $1 LIMIT 1`,
        [userId]
      );
      const inviterName = inviterResult.rows[0]?.name ?? "A team member";

      const token = crypto.randomBytes(32).toString("hex");

      let invite: Record<string, unknown>;
      try {
        const result = await pg.query(
          `INSERT INTO org_invites (organization_id, invited_by_user_id, email, role, seat_type, token)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, email, role, seat_type, expires_at, status`,
          [orgId, userId, email, role, seatType, digestToken(token)]
        );
        invite = result.rows[0] as Record<string, unknown>;
      } catch (err: unknown) {
        if ((err as { code?: string })?.code === "23505") {
          res.status(409).json({ error: "invite_already_sent" });
          return;
        }
        throw err;
      }

      const inviteUrl = `${getAppBaseUrl()}/accept-invite?token=${token}`;

      sendInviteEmail({ to: email, inviterName, orgName, role, inviteUrl, orgId }).catch((err) => {
        logger.warn({ event: "invite_email_failed", err }, "Invite email failed (non-fatal)");
      });

      writeAuditEvent({
        organizationId: orgId,
        actorUserId: userId,
        eventType: "team.invite_sent",
        resourceType: "org_invite",
        resourceId: invite.id as string,
        payload: { email: email.slice(0, 4) + "***", role },
        ipAddress: req.ip ?? null
      });

      logger.info({ event: "invite_sent", orgId, role }, "Team invite sent");

      res.status(201).json({ invite });
    } catch (err) {
      logger.error({ event: "invite_failed", err }, "POST /api/team/invite failed");
      res.status(500).json({ error: "invite_failed" });
    }
  }
));

/* =========================================================
   GET /api/team/members
   List active members + pending invites.
   ========================================================= */

router.get(
  "/team/members",
  requireApiKey,
  attachOrganizationContext,
  requireTeamCapability(),
  asTenant(async (req, res) => {
    try {
      const orgId = (req as any).organizationContext?.organizationId as string | null;

      if (!orgId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      const [membersResult, invitesResult, orgResult] = await Promise.all([
        pg.query<{
          id: string;
          email: string;
          name: string;
          role: string;
          status: string;
          created_at: string;
          last_used_at: string | null;
          lockout_until: string | null;
          totp_enabled: boolean;
        }>(
          `SELECT id, email, name, role, status, created_at, NULL AS last_used_at, lockout_until, totp_enabled
           FROM users
           WHERE organization_id = $1 AND status != 'inactive'
           ORDER BY created_at ASC`,
          [orgId]
        ),
        pg.query<{
          id: string;
          email: string;
          role: string;
          invited_by: string;
          expires_at: string;
          created_at: string;
        }>(
          `SELECT i.id, i.email, i.role, COALESCE(u.name, 'Unknown') AS invited_by,
                  i.expires_at, i.created_at
           FROM org_invites i
           LEFT JOIN users u ON u.id = i.invited_by_user_id
           WHERE i.organization_id = $1 AND i.status = 'pending'
             AND i.expires_at > NOW()
           ORDER BY i.created_at DESC`,
          [orgId]
        ),
        pg.query<{ max_members: number }>(
          `SELECT max_members FROM organizations WHERE id = $1 LIMIT 1`,
          [orgId]
        )
      ]);

      const members       = membersResult.rows;
      const pendingInvites = invitesResult.rows;
      const maxSeats      = orgResult.rows[0]?.max_members ?? 6;
      const activeCount   = members.filter(m => m.status === "active").length;

      res.status(200).json({
        members,
        pending_invites: pendingInvites,
        seat_usage: { used: activeCount, max: maxSeats }
      });
    } catch (err) {
      logger.error({ event: "team_members_failed", err }, "GET /api/team/members failed");
      res.status(500).json({ error: "fetch_failed" });
    }
  }
));

/* =========================================================
   DELETE /api/team/members/:userId
   Soft-remove a member from the org (admin only).
   ========================================================= */

router.delete(
  "/team/members/:userId",
  requireApiKey,
  attachOrganizationContext,
  requireTeamCapability(),
  requireRole("admin"),
  asTenant(async (req, res) => {
    try {
      const orgId        = (req as any).organizationContext?.organizationId as string | null;
      const actorUserId  = req.userId ?? null;
      const targetUserId = req.params.userId;

      if (!orgId || !actorUserId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      if (!isUuid(targetUserId)) {
        res.status(400).json({ error: "invalid_user_id" });
        return;
      }

      if (targetUserId === actorUserId) {
        res.status(400).json({ error: "cannot_remove_yourself" });
        return;
      }

      // Verify target belongs to this org
      const targetResult = await pg.query<{ id: string; role: string; status: string }>(
        `SELECT id, role, status FROM users WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [targetUserId, orgId]
      );

      const target = targetResult.rows[0];
      if (!target) {
        res.status(404).json({ error: "member_not_found" });
        return;
      }

      // Prevent removing the last admin
      if (target.role === "admin") {
        const adminCount = await pg.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM users
           WHERE organization_id = $1 AND role = 'admin' AND status = 'active'`,
          [orgId]
        );
        if (parseInt(adminCount.rows[0]?.count ?? "0", 10) <= 1) {
          res.status(400).json({ error: "cannot_remove_last_admin" });
          return;
        }
      }

      await pg.query(
        `UPDATE users SET status = 'inactive', updated_at = NOW() WHERE id = $1`,
        [targetUserId]
      );

      writeAuditEvent({
        organizationId: orgId,
        actorUserId: actorUserId,
        eventType: "team.member_removed",
        resourceType: "user",
        resourceId: targetUserId,
        ipAddress: req.ip ?? null
      });

      res.status(200).json({ ok: true });
    } catch (err) {
      logger.error({ event: "remove_member_failed", err }, "DELETE /api/team/members/:userId failed");
      res.status(500).json({ error: "remove_failed" });
    }
  }
));

/* =========================================================
   PATCH /api/team/members/:userId/role
   Change a member's role (admin only).
   ========================================================= */

router.patch(
  "/team/members/:userId/role",
  requireApiKey,
  attachOrganizationContext,
  requireTeamCapability(),
  requireRole("admin"),
  asTenant(async (req, res) => {
    try {
      const orgId        = (req as any).organizationContext?.organizationId as string | null;
      const actorUserId  = req.userId ?? null;
      const targetUserId = req.params.userId;

      if (!orgId || !actorUserId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      if (!isUuid(targetUserId)) {
        res.status(400).json({ error: "invalid_user_id" });
        return;
      }

      if (targetUserId === actorUserId) {
        res.status(400).json({ error: "cannot_change_own_role" });
        return;
      }

      const body    = req.body as Record<string, unknown>;
      const newRole = typeof body.role === "string" && VALID_ROLES.has(body.role) ? body.role : null;

      if (!newRole) {
        res.status(400).json({ error: "invalid_role", allowed: [...VALID_ROLES] });
        return;
      }

      // Verify target belongs to org
      const targetResult = await pg.query<{ id: string; role: string }>(
        `SELECT id, role FROM users WHERE id = $1 AND organization_id = $2 AND status = 'active' LIMIT 1`,
        [targetUserId, orgId]
      );

      const target = targetResult.rows[0];
      if (!target) {
        res.status(404).json({ error: "member_not_found" });
        return;
      }

      // Prevent demoting the last admin
      if (target.role === "admin" && newRole !== "admin") {
        const adminCount = await pg.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM users
           WHERE organization_id = $1 AND role = 'admin' AND status = 'active'`,
          [orgId]
        );
        if (parseInt(adminCount.rows[0]?.count ?? "0", 10) <= 1) {
          res.status(400).json({ error: "cannot_demote_last_admin" });
          return;
        }
      }

      await pg.query(
        `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2`,
        [newRole, targetUserId]
      );

      writeAuditEvent({
        organizationId: orgId,
        actorUserId: actorUserId,
        eventType: "team.role_changed",
        resourceType: "user",
        resourceId: targetUserId,
        payload: { new_role: newRole },
        ipAddress: req.ip ?? null
      });

      res.status(200).json({ member: { id: targetUserId, role: newRole } });
    } catch (err) {
      logger.error({ event: "role_change_failed", err }, "PATCH /api/team/members/:userId/role failed");
      res.status(500).json({ error: "role_change_failed" });
    }
  }
));

/* =========================================================
   DELETE /api/team/invites/:inviteId
   Revoke a pending invite (admin only).
   ========================================================= */

router.delete(
  "/team/invites/:inviteId",
  requireApiKey,
  attachOrganizationContext,
  requireTeamCapability(),
  requireRole("admin"),
  asTenant(async (req, res) => {
    try {
      const orgId    = (req as any).organizationContext?.organizationId as string | null;
      const inviteId = req.params.inviteId;

      if (!orgId) {
        res.status(403).json({ error: "organization_context_missing" });
        return;
      }

      if (!isUuid(inviteId)) {
        res.status(400).json({ error: "invalid_invite_id" });
        return;
      }

      const result = await pg.query(
        `UPDATE org_invites
         SET status = 'revoked'
         WHERE id = $1 AND organization_id = $2 AND status = 'pending'
         RETURNING id`,
        [inviteId, orgId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "invite_not_found" });
        return;
      }

      res.status(200).json({ ok: true });
    } catch (err) {
      logger.error({ event: "revoke_invite_failed", err }, "DELETE /api/team/invites/:inviteId failed");
      res.status(500).json({ error: "revoke_failed" });
    }
  }
));

/* =========================================================
   GET /api/team/invites/:token/preview
   Preview an invite before accepting. Public — no auth.
   ========================================================= */

router.get("/team/invites/:token/preview", asTenant(async (req, res) => {
  try {
    const token = req.params.token;

    if (!token || token.length < 8 || token.length > 128) {
      res.status(200).json({ valid: false, reason: "invalid_token" });
      return;
    }

    if (!isPresentableToken(token)) {
      res.status(200).json({ valid: false, reason: "not_found" });
      return;
    }
    const result = await pg.query<{
      email: string;
      role: string;
      org_name: string;
      inviter_name: string;
      status: string;
      expires_at: Date;
    }>(
      `SELECT i.email, i.role, i.status, i.expires_at,
              o.name AS org_name,
              COALESCE(u.name, 'A team member') AS inviter_name
       FROM org_invites i
       JOIN organizations o ON o.id = i.organization_id
       LEFT JOIN users u ON u.id = i.invited_by_user_id
       WHERE i.token IN ($1, $2)
       LIMIT 1`,
      [digestToken(String(token)), token]
    );

    if (result.rows.length === 0) {
      res.status(200).json({ valid: false, reason: "not_found" });
      return;
    }

    const invite = result.rows[0]!;

    if (invite.status !== "pending") {
      res.status(200).json({ valid: false, reason: invite.status });
      return;
    }

    if (new Date() > new Date(invite.expires_at)) {
      res.status(200).json({ valid: false, reason: "expired" });
      return;
    }

    res.status(200).json({
      valid: true,
      email: invite.email,
      orgName: invite.org_name,
      inviterName: invite.inviter_name,
      role: invite.role
    });
  } catch (err) {
    logger.error({ event: "invite_preview_failed", err }, "GET /api/team/invites/:token/preview failed");
    res.status(500).json({ valid: false, reason: "error" });
  }
}));

/* =========================================================
   POST /api/team/invites/:token/accept
   Accept an invite and create a user account. Public — no auth.
   ========================================================= */

const acceptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: rateLimitKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limit_exceeded" }
});

router.post("/team/invites/:token/accept", acceptLimiter, asTenant(async (req, res) => {
  try {
    const token       = req.params.token;
    const body        = req.body as Record<string, unknown>;
    const nameRaw     = body.name;
    const passwordRaw = body.password;

    if (!token || token.length < 8 || token.length > 128) {
      res.status(400).json({ error: "invalid_token" });
      return;
    }

    if (!isValidName(nameRaw)) {
      res.status(400).json({ error: "invalid_name" });
      return;
    }

    const pwErrInvite = validatePassword(passwordRaw);
    if (pwErrInvite) {
      res.status(400).json(pwErrInvite);
      return;
    }

    // Legal consent is required to accept an invite and create/activate an
    // account. The accept form must send acceptedTerms === true.
    if (body.acceptedTerms !== true) {
      res.status(400).json({
        error: "missing_terms_acceptance",
        detail: "You must accept the Terms of Service, Privacy Policy, and AI Transparency Policy to join."
      });
      return;
    }

    const name     = String(nameRaw).trim();
    const password = String(passwordRaw);

    // Look up invite
    if (!isPresentableToken(token)) {
      res.status(404).json({ error: "invite_not_found" });
      return;
    }
    const inviteResult = await pg.query<{
      id: string;
      organization_id: string;
      email: string;
      role: string;
      seat_type: string | null;
      status: string;
      expires_at: Date;
    }>(
      `SELECT id, organization_id, email, role, seat_type, status, expires_at
       FROM org_invites
       WHERE token IN ($1, $2)
       LIMIT 1`,
      [digestToken(String(token)), token]
    );

    if (inviteResult.rows.length === 0) {
      res.status(410).json({ error: "invite_expired_or_invalid" });
      return;
    }

    const invite = inviteResult.rows[0]!;

    if (invite.status !== "pending" || new Date() > new Date(invite.expires_at)) {
      res.status(410).json({ error: "invite_expired_or_invalid" });
      return;
    }

    // Check for existing user — block actives, reactivate inactives.
    // Inactive users (previously removed) may re-register via invite without
    // requiring a hard DB delete.
    const existingUserResult = await pg.query<{ id: string; status: string }>(
      `SELECT id, status FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [invite.email]
    );

    const existingUser = existingUserResult.rows[0] ?? null;

    if (existingUser && existingUser.status !== "inactive") {
      res.status(409).json({
        error: "email_already_registered",
        detail: "This email is already registered. Please log in instead."
      });
      return;
    }

    // Seat-cap enforcement on the ACCEPT path (fail closed). The invite-create
    // handler checks the cap at send time, but seats can fill between send and
    // accept — multiple pending invites, SSO JIT provisioning, or an
    // admin-lowered cap. Re-check here (same shared helper the SSO path uses)
    // so acceptance can never push the org over max_members. Both the new-user
    // INSERT and the inactive→active reactivation below consume a seat, so this
    // gates ahead of either. On rejection we return BEFORE the transaction, so
    // the invite stays 'pending' and the same link succeeds once a seat frees.
    // Under the seat model, the cap is enforced per CLASS against the invite's
    // seat type; with the flag off, the legacy whole-org (Full) cap applies.
    const inviteSeatType = invite.seat_type ?? "full";
    const seat = seatModelEnabled()
      ? await enforceSeatLimitForClass(invite.organization_id, inviteSeatType as SeatClass)
      : await enforceSeatLimit(invite.organization_id);
    if (seat.exceeded) {
      res.status(409).json({
        error: "seat_limit_reached",
        detail: `This organisation has reached its plan limit of ${seat.cap} ${seatModelEnabled() ? inviteSeatType + " seats" : "members"}. Ask an admin to free a seat or upgrade, then use this invite link again.`
      });
      return;
    }

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4
    });

    const client = await pg.connect();
    let newUserId: string;
    // SEC-JWT-EPOCH: set on both branches; see the note at each assignment.
    let newUserEpoch: number;

    try {
      await client.query("BEGIN");

      if (existingUser && existingUser.status === "inactive") {
        // Reactivate the removed user with fresh credentials and the invited role.
        // Reactivation installs a NEW credential on a pre-existing user id, so
        // it is a credential rotation: bump the epoch or any session minted
        // before the member was removed would resume working on reactivation.
        const reactivated = await client.query<{ session_epoch: number }>(
          `UPDATE users SET
             status        = 'active',
             name          = $1,
             password_hash = $2,
             role          = $3,
             seat_type     = $4,
             updated_at    = NOW(),
             session_epoch = session_epoch + 1
           WHERE id = $5
           RETURNING session_epoch`,
          [name, passwordHash, invite.role, inviteSeatType, existingUser.id]
        );
        newUserId    = existingUser.id;
        newUserEpoch = reactivated.rows[0]!.session_epoch;
      } else {
        const userResult = await client.query(
          `INSERT INTO users (organization_id, email, name, role, seat_type, status, password_hash, email_verified)
           VALUES ($1, $2, $3, $4, $5, 'active', $6, TRUE)
           RETURNING id, session_epoch`,
          [invite.organization_id, invite.email, name, invite.role, inviteSeatType, passwordHash]
        );
        newUserId    = userResult.rows[0].id as string;
        newUserEpoch = userResult.rows[0].session_epoch as number;

        // Record consent for the newly created user in the same transaction.
        // Reactivated (previously-inactive) users follow the UPDATE branch above
        // and are intentionally not recorded here — the requireConsent
        // middleware catches them on their next authenticated request.
        await recordAllCurrentConsents(client, {
          userId: newUserId,
          organizationId: invite.organization_id,
          consentMethod: "team_invite_accept",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        });
      }

      await client.query(
        `UPDATE org_invites
         SET status = 'accepted', accepted_at = NOW()
         WHERE id = $1`,
        [invite.id]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const jwt = signJwt(newUserId, invite.organization_id, invite.role, newUserEpoch);

    logger.info(
      { event: "invite_accepted", userId: newUserId, orgId: invite.organization_id },
      "Team invite accepted"
    );

    writeAuditEvent({
      organizationId: invite.organization_id,
      actorUserId: newUserId,
      eventType: "team.invite_accepted",
      resourceType: "user",
      resourceId: newUserId,
      ipAddress: req.ip ?? null
    });

    res.status(201).json({
      token: jwt,
      user: {
        id: newUserId,
        email: invite.email,
        name,
        role: invite.role,
        orgId: invite.organization_id
      }
    });
  } catch (err) {
    logger.error({ event: "invite_accept_failed", err }, "POST /api/team/invites/:token/accept failed");
    res.status(500).json({ error: "accept_failed" });
  }
}));

export default router;
