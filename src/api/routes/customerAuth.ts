/**
 * customerAuth.ts — Email/password authentication for app.securelogicai.com.
 *
 * Routes:
 *   POST /api/auth/signup              — Create account (org + user + API key)
 *   POST /api/auth/verify-email        — Verify email with token
 *   POST /api/auth/resend-verification — Resend verification email
 *   POST /api/auth/login               — Email + password → JWT
 *   POST /api/auth/logout              — Stateless; client drops the token
 *   POST /api/auth/forgot-password     — Send password reset email
 *   POST /api/auth/reset-password      — Reset password with token
 *   GET  /api/auth/me                  — Current user (JWT required)
 *
 * Security:
 *   - Passwords hashed with argon2id
 *   - JWT signed with HS256 (JWT_SECRET), 7-day expiry
 *   - Verification and reset tokens: 64-byte hex (crypto.randomBytes)
 *   - Always-OK responses on forgot-password (enumeration prevention)
 *   - Rate limits: signup 5/hr, login 10/15min, forgot-password 3/hr
 */

import { Router } from "express";
import crypto from "crypto";
import argon2 from "argon2";
import rateLimit from "express-rate-limit";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { signJwt, signMfaChallenge } from "../lib/jwt.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { Resend } from "resend";

const router = Router();

/* =========================================================
   RATE LIMITS
   ========================================================= */

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limit_exceeded" }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limit_exceeded" }
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limit_exceeded" }
});

const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limit_exceeded" }
});

/* =========================================================
   CONSTANTS
   ========================================================= */

const VERIFICATION_TTL_MS   = 24 * 60 * 60 * 1000; // 24 hours
const RESET_TTL_MS          = 60 * 60 * 1000;       // 1 hour

/* =========================================================
   HELPERS
   ========================================================= */

function isValidEmail(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const t = v.trim();
  return t.length >= 3 && t.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

function isValidPassword(v: unknown): v is string {
  return typeof v === "string" && v.length >= 8 && v.length <= 128;
}

function isValidName(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const t = v.trim();
  return t.length >= 1 && t.length <= 120;
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex"); // 64 hex chars
}

function generateApiKey(): string {
  return "sl_" + crypto.randomBytes(16).toString("hex");
}

function slugify(name: string, suffix: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `${base}-${suffix}`;
}

function getAppBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "https://app.securelogicai.com").replace(/\/$/, "");
}

function getResend(): Resend {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new Error("RESEND_API_KEY not set");
  return new Resend(key);
}

function getFromAddress(): string {
  return process.env.NEWSLETTER_FROM_EMAIL?.trim() ?? "SecureLogic AI <noreply@securelogicai.com>";
}

/* =========================================================
   EMAIL TEMPLATES (dark navy — matches Intelligence Brief style)
   ========================================================= */

function verificationEmailHtml(name: string, verificationUrl: string): string {
  const safeName = name.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] ?? c));
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0f1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#0a0f1a">
  <tr><td align="center" style="padding:40px 16px;">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
      <!-- Logo -->
      <tr><td align="center" style="padding-bottom:32px;">
        <img src="https://api.securelogicai.com/assets/logo.png" alt="SecureLogic AI" height="36" style="display:block;">
      </td></tr>
      <!-- Card -->
      <tr><td style="background:#0d1b2e;border:1px solid #1e2d45;border-radius:12px;padding:40px;">
        <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f1f5f9;">Verify your email</p>
        <p style="margin:0 0 24px;font-size:15px;color:#94a3b8;">Hi ${safeName}, click the button below to verify your email address and activate your SecureLogic AI account.</p>
        <table cellpadding="0" cellspacing="0"><tr><td>
          <a href="${verificationUrl}"
             style="display:inline-block;background:#00c4b4;color:#0a0f1a;font-size:15px;font-weight:600;text-decoration:none;padding:14px 28px;border-radius:8px;">
            Verify Email Address
          </a>
        </td></tr></table>
        <p style="margin:24px 0 0;font-size:13px;color:#64748b;">This link expires in 24 hours. If you did not create an account, you can safely ignore this email.</p>
      </td></tr>
      <!-- Footer -->
      <tr><td align="center" style="padding:24px 0 0;">
        <p style="margin:0;font-size:12px;color:#334155;">© ${new Date().getFullYear()} SecureLogic AI. All rights reserved.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function passwordResetEmailHtml(name: string, resetUrl: string): string {
  const safeName = name.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] ?? c));
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0f1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#0a0f1a">
  <tr><td align="center" style="padding:40px 16px;">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
      <tr><td align="center" style="padding-bottom:32px;">
        <img src="https://api.securelogicai.com/assets/logo.png" alt="SecureLogic AI" height="36" style="display:block;">
      </td></tr>
      <tr><td style="background:#0d1b2e;border:1px solid #1e2d45;border-radius:12px;padding:40px;">
        <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f1f5f9;">Reset your password</p>
        <p style="margin:0 0 24px;font-size:15px;color:#94a3b8;">Hi ${safeName}, click the button below to set a new password for your SecureLogic AI account.</p>
        <table cellpadding="0" cellspacing="0"><tr><td>
          <a href="${resetUrl}"
             style="display:inline-block;background:#00c4b4;color:#0a0f1a;font-size:15px;font-weight:600;text-decoration:none;padding:14px 28px;border-radius:8px;">
            Reset Password
          </a>
        </td></tr></table>
        <p style="margin:24px 0 0;font-size:13px;color:#64748b;">This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.</p>
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

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const resend = getResend();
  await resend.emails.send({ from: getFromAddress(), to: [to], subject, html });
}

/* =========================================================
   POST /api/auth/signup
   { organizationName, name, email, password, promoCode? }
   ========================================================= */

router.post("/auth/signup", signupLimiter, async (req, res) => {
  try {
    const orgNameRaw   = req.body?.organizationName;
    const nameRaw      = req.body?.name;
    const emailRaw     = req.body?.email;
    const passwordRaw  = req.body?.password;
    const promoCodeRaw = req.body?.promoCode;

    if (!isValidName(orgNameRaw)) {
      res.status(400).json({ error: "invalid_organization_name", detail: "1–100 characters required" });
      return;
    }
    if (!isValidName(nameRaw)) {
      res.status(400).json({ error: "invalid_name", detail: "1–120 characters required" });
      return;
    }
    if (!isValidEmail(emailRaw)) {
      res.status(400).json({ error: "invalid_email" });
      return;
    }
    if (!isValidPassword(passwordRaw)) {
      res.status(400).json({ error: "invalid_password", detail: "8–128 characters required" });
      return;
    }

    const orgName   = String(orgNameRaw).trim();
    const name      = String(nameRaw).trim();
    const email     = String(emailRaw).trim().toLowerCase();
    const promoCode = typeof promoCodeRaw === "string" && promoCodeRaw.trim().length > 0
      ? promoCodeRaw.trim().toUpperCase()
      : null;

    // Check for existing account (email uniqueness)
    const existing = await pg.query(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );
    if (existing.rows.length > 0) {
      res.status(409).json({ error: "email_already_registered" });
      return;
    }

    const passwordHash         = await argon2.hash(String(passwordRaw));
    const verificationToken    = generateToken();
    const verificationExpires  = new Date(Date.now() + VERIFICATION_TTL_MS);
    const slugSuffix           = crypto.randomBytes(3).toString("hex");
    const slug                 = slugify(orgName, slugSuffix);
    const rawApiKey            = generateApiKey();
    const keyHash              = crypto.createHash("sha256").update(rawApiKey).digest("hex");

    const client = await pg.connect();
    let orgId: string;
    let userId: string;

    try {
      await client.query("BEGIN");

      const orgResult = await client.query(
        `INSERT INTO organizations (name, slug, plan, status, promo_code)
         VALUES ($1, $2, 'starter', 'active', $3)
         RETURNING id`,
        [orgName, slug, promoCode]
      );
      orgId = orgResult.rows[0].id as string;

      await client.query(
        `INSERT INTO api_keys (organization_id, label, key_hash, entitlement_level, status)
         VALUES ($1, $2, $3, 'starter', 'active')`,
        [orgId, email, keyHash]
      );

      const userResult = await client.query(
        `INSERT INTO users (organization_id, email, name, password_hash,
                            email_verified, email_verification_token, email_verification_expires_at)
         VALUES ($1, $2, $3, $4, FALSE, $5, $6)
         RETURNING id`,
        [orgId, email, name, passwordHash, verificationToken, verificationExpires]
      );
      userId = userResult.rows[0].id as string;

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    logger.info(
      { event: "customer_signup", userId, orgId, email: email.slice(0, 4) + "***" },
      "Customer signup complete"
    );

    writeAuditEvent({
      organizationId: orgId,
      actorUserId: userId,
      eventType: "auth.signup",
      resourceType: "user",
      resourceId: userId,
      payload: { email: email.slice(0, 4) + "***" },
      ipAddress: req.ip ?? null
    });

    // Send verification email (non-blocking; failure doesn't abort the signup)
    const verificationUrl = `${getAppBaseUrl()}/verify-email?token=${verificationToken}`;
    sendEmail(email, "Verify your SecureLogic AI account", verificationEmailHtml(name, verificationUrl))
      .catch((err) => {
        logger.warn({ event: "signup_verification_email_failed", userId, err }, "Verification email not sent");
      });

    res.status(201).json({ ok: true, message: "verification_email_sent" });
  } catch (err) {
    logger.error({ event: "customer_signup_failed", err }, "POST /api/auth/signup failed");
    res.status(500).json({ error: "signup_failed" });
  }
});

/* =========================================================
   POST /api/auth/verify-email
   { token: string }
   ========================================================= */

router.post("/auth/verify-email", verifyLimiter, async (req, res) => {
  try {
    const tokenRaw = req.body?.token;
    const token    = typeof tokenRaw === "string" ? tokenRaw.trim() : null;

    if (!token || token.length < 8 || token.length > 128) {
      res.status(400).json({ error: "invalid_token" });
      return;
    }

    const result = await pg.query(
      `SELECT id, organization_id, name, role, email_verification_expires_at
       FROM users
       WHERE email_verification_token = $1 AND email_verified = FALSE
       LIMIT 1`,
      [token]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "token_not_found_or_already_verified" });
      return;
    }

    const user = result.rows[0] as {
      id: string;
      organization_id: string;
      name: string;
      role: string;
      email_verification_expires_at: Date;
    };

    if (new Date() > new Date(user.email_verification_expires_at)) {
      res.status(410).json({ error: "token_expired" });
      return;
    }

    await pg.query(
      `UPDATE users
       SET email_verified = TRUE,
           email_verification_token = NULL,
           email_verification_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [user.id]
    );

    const jwt = signJwt(user.id, user.organization_id, user.role || "viewer");

    logger.info({ event: "email_verified", userId: user.id }, "Email verified");

    writeAuditEvent({
      organizationId: user.organization_id,
      actorUserId: user.id,
      eventType: "auth.email_verified",
      resourceType: "user",
      resourceId: user.id,
      ipAddress: req.ip ?? null
    });

    res.status(200).json({ ok: true, token: jwt });
  } catch (err) {
    logger.error({ event: "email_verify_failed", err }, "POST /api/auth/verify-email failed");
    res.status(500).json({ error: "verification_failed" });
  }
});

/* =========================================================
   POST /api/auth/resend-verification
   { email: string }
   ========================================================= */

router.post("/auth/resend-verification", forgotPasswordLimiter, async (req, res) => {
  const respond = () => res.status(200).json({ ok: true });

  try {
    const emailRaw = req.body?.email;
    if (!isValidEmail(emailRaw)) { respond(); return; }

    const email = String(emailRaw).trim().toLowerCase();

    const result = await pg.query(
      `SELECT id, name, email_verified FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );

    if (result.rows.length === 0 || result.rows[0].email_verified) {
      respond();
      return;
    }

    const user = result.rows[0] as { id: string; name: string };

    const verificationToken   = generateToken();
    const verificationExpires = new Date(Date.now() + VERIFICATION_TTL_MS);

    await pg.query(
      `UPDATE users
       SET email_verification_token = $1,
           email_verification_expires_at = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [verificationToken, verificationExpires, user.id]
    );

    const verificationUrl = `${getAppBaseUrl()}/verify-email?token=${verificationToken}`;
    sendEmail(email, "Verify your SecureLogic AI account", verificationEmailHtml(user.name, verificationUrl))
      .catch((err) => {
        logger.warn({ event: "resend_verification_email_failed", userId: user.id, err }, "Resend verification email failed");
      });

    respond();
  } catch (err) {
    logger.error({ event: "resend_verification_failed", err }, "POST /api/auth/resend-verification failed");
    respond();
  }
});

/* =========================================================
   POST /api/auth/login
   { email, password }
   ========================================================= */

router.post("/auth/login", loginLimiter, async (req, res) => {
  try {
    const emailRaw    = req.body?.email;
    const passwordRaw = req.body?.password;

    if (!isValidEmail(emailRaw) || typeof passwordRaw !== "string") {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const email = String(emailRaw).trim().toLowerCase();

    const result = await pg.query<{
      id: string;
      organization_id: string;
      name: string;
      email: string;
      role: string;
      password_hash: string;
      email_verified: boolean;
      totp_enabled: boolean;
    }>(
      `SELECT id, organization_id, name, email, role, password_hash, email_verified, totp_enabled
       FROM users
       WHERE email = $1
       LIMIT 1`,
      [email]
    );

    // Constant-time path: always verify password even when user not found
    // to prevent timing-based email enumeration
    const dummyHash = "$argon2id$v=19$m=65536,t=3,p=4$dummy$dummy";
    const user      = result.rows[0] ?? null;
    const hash      = user?.password_hash ?? dummyHash;

    let passwordValid = false;
    try {
      passwordValid = await argon2.verify(hash, String(passwordRaw));
    } catch {
      passwordValid = false;
    }

    if (!user || !passwordValid) {
      writeAuditEvent({
        actorUserId: null,
        eventType: "auth.login_failed",
        resourceType: "user",
        payload: { reason: !user ? "user_not_found" : "wrong_password" },
        ipAddress: req.ip ?? null
      });
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    if (!user.email_verified) {
      res.status(403).json({ error: "email_not_verified" });
      return;
    }

    // MFA challenge — issue a short-lived token instead of a full session
    if (user.totp_enabled) {
      const mfaToken = signMfaChallenge(user.id, user.organization_id);
      logger.info({ event: "customer_login_mfa_required", userId: user.id }, "MFA required");
      res.status(200).json({ mfa_required: true, mfa_token: mfaToken });
      return;
    }

    // Fetch org for display info
    const orgResult = await pg.query<{
      name: string;
      entitlement_level: string;
      onboarding_completed_at: string | null;
    }>(
      `SELECT o.name,
              COALESCE(k.entitlement_level, 'starter') AS entitlement_level,
              o.onboarding_completed_at
       FROM organizations o
       LEFT JOIN api_keys k ON k.organization_id = o.id AND k.status = 'active'
       WHERE o.id = $1
       ORDER BY k.created_at ASC
       LIMIT 1`,
      [user.organization_id]
    );

    const orgName              = orgResult.rows[0]?.name ?? "Your Organisation";
    const entitlementLevel     = orgResult.rows[0]?.entitlement_level ?? "starter";
    const onboardingCompleted  = orgResult.rows[0]?.onboarding_completed_at !== null
      && orgResult.rows[0]?.onboarding_completed_at !== undefined;
    const userRole             = user.role || "viewer";

    const jwt = signJwt(user.id, user.organization_id, userRole);

    logger.info({ event: "customer_login", userId: user.id }, "Customer logged in");

    writeAuditEvent({
      organizationId: user.organization_id,
      actorUserId: user.id,
      eventType: "auth.login",
      resourceType: "user",
      resourceId: user.id,
      ipAddress: req.ip ?? null
    });

    res.status(200).json({
      ok: true,
      token: jwt,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: userRole,
        organizationId: user.organization_id,
        organizationName: orgName,
        entitlementLevel,
        onboardingCompleted
      }
    });
  } catch (err) {
    logger.error({ event: "customer_login_failed", err }, "POST /api/auth/login failed");
    res.status(500).json({ error: "login_failed" });
  }
});

/* =========================================================
   POST /api/auth/logout
   Stateless — client drops the JWT. Server records the event.
   ========================================================= */

router.post("/auth/logout", requireAuth, (req, res) => {
  writeAuditEvent({
    organizationId: req.jwtPayload?.org ?? null,
    actorUserId: req.jwtPayload?.sub ?? null,
    eventType: "auth.logout",
    resourceType: "user",
    resourceId: req.jwtPayload?.sub ?? null,
    ipAddress: req.ip ?? null
  });

  logger.info({ event: "customer_logout", userId: req.jwtPayload?.sub }, "Customer logged out");
  res.status(200).json({ ok: true });
});

/* =========================================================
   POST /api/auth/forgot-password
   { email: string }
   Always responds { ok: true } — enumeration prevention.
   ========================================================= */

router.post("/auth/forgot-password", forgotPasswordLimiter, async (req, res) => {
  const respond = () => res.status(200).json({ ok: true });

  try {
    const emailRaw = req.body?.email;
    if (!isValidEmail(emailRaw)) { respond(); return; }

    const email = String(emailRaw).trim().toLowerCase();

    const result = await pg.query<{ id: string; name: string; email_verified: boolean }>(
      `SELECT id, name, email_verified FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );

    if (result.rows.length === 0 || !result.rows[0]!.email_verified) {
      respond();
      return;
    }

    const user       = result.rows[0]!;
    const resetToken = generateToken();
    const resetExpires = new Date(Date.now() + RESET_TTL_MS);

    await pg.query(
      `UPDATE users
       SET password_reset_token = $1,
           password_reset_expires_at = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [resetToken, resetExpires, user.id]
    );

    const resetUrl = `${getAppBaseUrl()}/reset-password?token=${resetToken}`;
    sendEmail(email, "Reset your SecureLogic AI password", passwordResetEmailHtml(user.name, resetUrl))
      .catch((err) => {
        logger.warn({ event: "password_reset_email_failed", userId: user.id, err }, "Password reset email not sent");
      });

    logger.info({ event: "password_reset_requested", userId: user.id }, "Password reset requested");

    respond();
  } catch (err) {
    logger.error({ event: "forgot_password_failed", err }, "POST /api/auth/forgot-password failed");
    respond();
  }
});

/* =========================================================
   POST /api/auth/reset-password
   { token: string, password: string }
   ========================================================= */

router.post("/auth/reset-password", verifyLimiter, async (req, res) => {
  try {
    const tokenRaw    = req.body?.token;
    const passwordRaw = req.body?.password;

    const token = typeof tokenRaw === "string" ? tokenRaw.trim() : null;

    if (!token || token.length < 8 || token.length > 128) {
      res.status(400).json({ error: "invalid_token" });
      return;
    }

    if (!isValidPassword(passwordRaw)) {
      res.status(400).json({ error: "invalid_password", detail: "8–128 characters required" });
      return;
    }

    const result = await pg.query<{
      id: string;
      organization_id: string;
      password_reset_expires_at: Date;
    }>(
      `SELECT id, organization_id, password_reset_expires_at
       FROM users
       WHERE password_reset_token = $1
       LIMIT 1`,
      [token]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "token_not_found_or_expired" });
      return;
    }

    const user = result.rows[0]!;

    if (new Date() > new Date(user.password_reset_expires_at)) {
      res.status(410).json({ error: "token_expired" });
      return;
    }

    const newHash = await argon2.hash(String(passwordRaw));

    await pg.query(
      `UPDATE users
       SET password_hash = $1,
           password_reset_token = NULL,
           password_reset_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $2`,
      [newHash, user.id]
    );

    logger.info({ event: "password_reset", userId: user.id }, "Password reset complete");

    writeAuditEvent({
      organizationId: user.organization_id,
      actorUserId: user.id,
      eventType: "auth.password_reset",
      resourceType: "user",
      resourceId: user.id,
      ipAddress: req.ip ?? null
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error({ event: "reset_password_failed", err }, "POST /api/auth/reset-password failed");
    res.status(500).json({ error: "reset_failed" });
  }
});

/* =========================================================
   GET /api/auth/me   (JWT required)
   ========================================================= */

router.get("/auth/me", requireAuth, async (req, res) => {
  try {
    const userId = req.jwtPayload!.sub;
    const orgId  = req.jwtPayload!.org;

    const userResult = await pg.query<{ id: string; email: string; name: string; role: string; totp_enabled: boolean }>(
      `SELECT id, email, name, role, totp_enabled FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }

    const [orgResult, suppressionResult] = await Promise.all([
      pg.query<{
        name: string;
        entitlement_level: string;
        payment_failed_at: string | null;
        onboarding_completed_at: string | null;
      }>(
        `SELECT o.name, COALESCE(k.entitlement_level, 'starter') AS entitlement_level,
                k.payment_failed_at,
                o.onboarding_completed_at
         FROM organizations o
         LEFT JOIN api_keys k ON k.organization_id = o.id AND k.status = 'active'
         WHERE o.id = $1
         ORDER BY k.created_at ASC
         LIMIT 1`,
        [orgId]
      ),
      pg.query<{ id: string }>(
        `SELECT id FROM email_suppressions WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [userResult.rows[0]!.email]
      )
    ]);

    const user            = userResult.rows[0]!;
    const org             = orgResult.rows[0];
    const emailSuppressed = suppressionResult.rows.length > 0;

    res.status(200).json({
      id:                  user.id,
      email:               user.email,
      name:                user.name,
      role:                user.role || "viewer",
      organizationId:      orgId,
      organizationName:    org?.name ?? "Your Organisation",
      entitlementLevel:    org?.entitlement_level ?? "starter",
      billingActive:       org?.entitlement_level !== "starter" && !org?.payment_failed_at,
      emailSuppressed,
      onboardingCompleted: org?.onboarding_completed_at !== null && org?.onboarding_completed_at !== undefined,
      totpEnabled:         user.totp_enabled ?? false
    });
  } catch (err) {
    logger.error({ event: "auth_me_failed", err }, "GET /api/auth/me failed");
    res.status(500).json({ error: "fetch_failed" });
  }
});

/* =========================================================
   POST /api/auth/onboarding-complete   (JWT required)
   Marks the organization's onboarding as complete.
   ========================================================= */

router.post("/auth/onboarding-complete", requireAuth, async (req, res) => {
  try {
    const orgId = req.jwtPayload!.org;

    await pg.query(
      `UPDATE organizations
       SET onboarding_completed_at = NOW()
       WHERE id = $1
         AND onboarding_completed_at IS NULL`,
      [orgId]
    );

    logger.info({ event: "onboarding_complete", orgId }, "Onboarding marked complete");
    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error({ event: "onboarding_complete_failed", err }, "POST /api/auth/onboarding-complete failed");
    res.status(500).json({ error: "onboarding_complete_failed" });
  }
});

export default router;
