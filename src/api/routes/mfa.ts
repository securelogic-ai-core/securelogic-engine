/**
 * mfa.ts — TOTP multi-factor authentication routes.
 *
 * Routes:
 *   POST   /api/auth/mfa/setup          — Generate TOTP secret and QR code (requires session JWT)
 *   POST   /api/auth/mfa/verify-setup   — Confirm TOTP code, issue backup codes (requires session JWT)
 *   POST   /api/auth/mfa/verify         — Verify TOTP code during login (requires mfa_token)
 *   POST   /api/auth/mfa/use-backup     — Use a backup code during login (requires mfa_token)
 *   POST   /api/auth/mfa/disable        — Disable MFA with password + code confirmation (requires session JWT)
 *   DELETE /api/auth/mfa/reset/:userId  — Admin reset of any user's MFA (requires session JWT + admin role)
 */

import crypto from "crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import argon2 from "argon2";
import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";

import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { signJwt, signMfaChallenge, verifyMfaChallenge } from "../lib/jwt.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdminRole } from "../middleware/requireRole.js";
import { encryptSecret, decryptSecret } from "../lib/mfaEncryption.js";

const router = Router();

/* =========================================================
   RATE LIMITING (per-userId sliding window, 5 attempts / 5 min)
   ========================================================= */

const mfaAttempts = new Map<string, { count: number; resetAt: number }>();

function checkMfaRateLimit(userId: string): boolean {
  const now     = Date.now();
  const windowMs = 5 * 60 * 1000;
  const entry   = mfaAttempts.get(userId);
  if (!entry || entry.resetAt <= now) {
    mfaAttempts.set(userId, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= 5) return false;
  entry.count++;
  return true;
}

function clearMfaRateLimit(userId: string): void {
  mfaAttempts.delete(userId);
}

/* =========================================================
   HELPERS
   ========================================================= */

// ±30s tolerance (one full time step) — covers clock drift
const TOTP_OPTS = {
  algorithm: "sha1" as const,
  digits: 6 as const,
  period: 30,
  epochTolerance: 30
};

async function buildFullLoginResponse(userId: string, orgId: string, role: string) {
  const [userResult, orgResult] = await Promise.all([
    pg.query<{ id: string; email: string; name: string }>(
      `SELECT id, email, name FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    ),
    pg.query<{ name: string; entitlement_level: string; onboarding_completed_at: string | null }>(
      `SELECT o.name,
              COALESCE(k.entitlement_level, 'starter') AS entitlement_level,
              o.onboarding_completed_at
       FROM organizations o
       LEFT JOIN api_keys k ON k.organization_id = o.id AND k.status = 'active'
       WHERE o.id = $1
       ORDER BY k.created_at ASC LIMIT 1`,
      [orgId]
    )
  ]);

  const user  = userResult.rows[0]!;
  const org   = orgResult.rows[0];
  const token = signJwt(userId, orgId, role);

  return {
    ok: true as const,
    token,
    user: {
      id:                  user.id,
      email:               user.email,
      name:                user.name,
      role,
      organizationId:      orgId,
      organizationName:    org?.name ?? "Your Organisation",
      entitlementLevel:    org?.entitlement_level ?? "starter",
      onboardingCompleted: org?.onboarding_completed_at !== null
                           && org?.onboarding_completed_at !== undefined
    }
  };
}

/* =========================================================
   POST /api/auth/mfa/setup
   Requires: session JWT (via requireAuth)
   ========================================================= */

router.post("/auth/mfa/setup", requireAuth, async (req, res) => {
  try {
    const userId = req.jwtPayload!.sub;

    const result = await pg.query<{ totp_enabled: boolean; email: string }>(
      `SELECT totp_enabled, email FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }

    if (result.rows[0]!.totp_enabled) {
      res.status(409).json({ error: "mfa_already_enabled" });
      return;
    }

    const userEmail = result.rows[0]!.email;
    const secret    = generateSecret();
    const encrypted = encryptSecret(secret);

    await pg.query(
      `UPDATE users SET totp_secret = $1, totp_enabled = false, updated_at = NOW() WHERE id = $2`,
      [encrypted, userId]
    );

    const otpauthUri = generateURI({
      issuer:    "SecureLogic",
      label:     userEmail,
      secret,
      algorithm: "sha1",
      digits:    6,
      period:    30
    });

    const qrCodeUrl = await QRCode.toDataURL(otpauthUri, { width: 256, margin: 2 });

    res.status(200).json({
      qr_code_url:      qrCodeUrl,
      manual_entry_key: secret
    });
  } catch (err) {
    logger.error({ event: "mfa_setup_failed", err }, "POST /api/auth/mfa/setup failed");
    res.status(500).json({ error: "setup_failed" });
  }
});

/* =========================================================
   POST /api/auth/mfa/verify-setup
   Body: { code: string }
   Requires: session JWT
   ========================================================= */

router.post("/auth/mfa/verify-setup", requireAuth, async (req, res) => {
  try {
    const userId  = req.jwtPayload!.sub;
    const codeRaw = req.body?.code;
    const code    = typeof codeRaw === "string" ? codeRaw.trim() : "";

    if (!code) {
      res.status(400).json({ error: "code_required" });
      return;
    }

    const result = await pg.query<{ totp_secret: string | null; totp_enabled: boolean }>(
      `SELECT totp_secret, totp_enabled FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }

    const { totp_secret, totp_enabled } = result.rows[0]!;

    if (totp_enabled) {
      res.status(409).json({ error: "mfa_already_enabled" });
      return;
    }

    if (!totp_secret) {
      res.status(400).json({ error: "mfa_setup_not_started" });
      return;
    }

    const secret       = decryptSecret(totp_secret);
    const { valid }    = verifySync({ token: code, secret, ...TOTP_OPTS });

    if (!valid) {
      res.status(400).json({ error: "invalid_code" });
      return;
    }

    const plainCodes: string[] = Array.from({ length: 8 }, () =>
      crypto.randomBytes(5).toString("hex")
    );
    const hashedCodes = await Promise.all(
      plainCodes.map((c) => bcrypt.hash(c, 10))
    );

    await pg.query(
      `UPDATE users
       SET totp_enabled = true, totp_backup_codes = $1, updated_at = NOW()
       WHERE id = $2`,
      [hashedCodes, userId]
    );

    writeAuditEvent({
      organizationId: req.jwtPayload!.org,
      actorUserId:    userId,
      eventType:      "auth.mfa_enabled",
      resourceType:   "user",
      resourceId:     userId,
      ipAddress:      req.ip ?? null
    });

    logger.info({ event: "mfa_enabled", userId }, "MFA enabled");

    res.status(200).json({ backup_codes: plainCodes });
  } catch (err) {
    logger.error({ event: "mfa_verify_setup_failed", err }, "POST /api/auth/mfa/verify-setup failed");
    res.status(500).json({ error: "verify_setup_failed" });
  }
});

/* =========================================================
   POST /api/auth/mfa/verify
   Body: { code: string, mfa_token: string }
   Auth: mfa_token (short-lived challenge JWT, not a session)
   ========================================================= */

router.post("/auth/mfa/verify", async (req, res) => {
  try {
    const codeRaw     = req.body?.code;
    const mfaTokenRaw = req.body?.mfa_token;
    const code        = typeof codeRaw     === "string" ? codeRaw.trim()     : "";
    const mfaTokenStr = typeof mfaTokenRaw === "string" ? mfaTokenRaw.trim() : "";

    if (!code || !mfaTokenStr) {
      res.status(400).json({ error: "missing_fields" });
      return;
    }

    const challenge = verifyMfaChallenge(mfaTokenStr);
    if (!challenge) {
      res.status(401).json({ error: "invalid_or_expired_mfa_token" });
      return;
    }

    const { sub: userId, org: orgId } = challenge;

    if (!checkMfaRateLimit(userId)) {
      res.status(429).json({ error: "too_many_attempts" });
      return;
    }

    const result = await pg.query<{
      totp_secret: string | null;
      totp_enabled: boolean;
      role: string;
    }>(
      `SELECT totp_secret, totp_enabled, role FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0 || !result.rows[0]!.totp_enabled || !result.rows[0]!.totp_secret) {
      res.status(400).json({ error: "mfa_not_configured" });
      return;
    }

    const { totp_secret, role } = result.rows[0]!;
    const secret    = decryptSecret(totp_secret!);
    const { valid } = verifySync({ token: code, secret, ...TOTP_OPTS });

    if (!valid) {
      res.status(400).json({ error: "invalid_code" });
      return;
    }

    clearMfaRateLimit(userId);

    const response = await buildFullLoginResponse(userId, orgId, role);

    writeAuditEvent({
      organizationId: orgId,
      actorUserId:    userId,
      eventType:      "auth.login",
      resourceType:   "user",
      resourceId:     userId,
      payload:        { method: "totp" },
      ipAddress:      req.ip ?? null
    });

    logger.info({ event: "mfa_login_success", userId }, "MFA login complete");

    res.status(200).json(response);
  } catch (err) {
    logger.error({ event: "mfa_verify_failed", err }, "POST /api/auth/mfa/verify failed");
    res.status(500).json({ error: "verify_failed" });
  }
});

/* =========================================================
   POST /api/auth/mfa/use-backup
   Body: { backup_code: string, mfa_token: string }
   Auth: mfa_token
   ========================================================= */

router.post("/auth/mfa/use-backup", async (req, res) => {
  try {
    const backupCodeRaw = req.body?.backup_code;
    const mfaTokenRaw   = req.body?.mfa_token;
    const backupCode    = typeof backupCodeRaw === "string" ? backupCodeRaw.trim() : "";
    const mfaTokenStr   = typeof mfaTokenRaw   === "string" ? mfaTokenRaw.trim()  : "";

    if (!backupCode || !mfaTokenStr) {
      res.status(400).json({ error: "missing_fields" });
      return;
    }

    const challenge = verifyMfaChallenge(mfaTokenStr);
    if (!challenge) {
      res.status(401).json({ error: "invalid_or_expired_mfa_token" });
      return;
    }

    const { sub: userId, org: orgId } = challenge;

    if (!checkMfaRateLimit(userId)) {
      res.status(429).json({ error: "too_many_attempts" });
      return;
    }

    const result = await pg.query<{
      totp_backup_codes: string[];
      totp_enabled: boolean;
      role: string;
    }>(
      `SELECT totp_backup_codes, totp_enabled, role FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0 || !result.rows[0]!.totp_enabled) {
      res.status(400).json({ error: "mfa_not_configured" });
      return;
    }

    const { totp_backup_codes: storedHashes, role } = result.rows[0]!;

    let matchIndex = -1;
    for (let i = 0; i < storedHashes.length; i++) {
      if (await bcrypt.compare(backupCode, storedHashes[i]!)) {
        matchIndex = i;
        break;
      }
    }

    if (matchIndex === -1) {
      res.status(400).json({ error: "invalid_backup_code" });
      return;
    }

    // Remove the used backup code (single-use)
    const remaining = storedHashes.filter((_, i) => i !== matchIndex);
    await pg.query(
      `UPDATE users SET totp_backup_codes = $1, updated_at = NOW() WHERE id = $2`,
      [remaining, userId]
    );

    clearMfaRateLimit(userId);

    const response = await buildFullLoginResponse(userId, orgId, role);

    writeAuditEvent({
      organizationId: orgId,
      actorUserId:    userId,
      eventType:      "auth.login",
      resourceType:   "user",
      resourceId:     userId,
      payload:        { method: "backup_code" },
      ipAddress:      req.ip ?? null
    });

    logger.info({ event: "mfa_backup_login_success", userId }, "MFA backup-code login complete");

    res.status(200).json(response);
  } catch (err) {
    logger.error({ event: "mfa_use_backup_failed", err }, "POST /api/auth/mfa/use-backup failed");
    res.status(500).json({ error: "use_backup_failed" });
  }
});

/* =========================================================
   POST /api/auth/mfa/disable
   Body: { password: string, code: string }
   Requires: session JWT
   ========================================================= */

router.post("/auth/mfa/disable", requireAuth, async (req, res) => {
  try {
    const userId      = req.jwtPayload!.sub;
    const passwordRaw = req.body?.password;
    const codeRaw     = req.body?.code;

    if (typeof passwordRaw !== "string" || !passwordRaw) {
      res.status(400).json({ error: "password_required" });
      return;
    }

    const codeStr = typeof codeRaw === "string" ? codeRaw.trim() : "";
    if (!codeStr) {
      res.status(400).json({ error: "code_required" });
      return;
    }

    const result = await pg.query<{
      password_hash: string;
      totp_secret: string | null;
      totp_enabled: boolean;
    }>(
      `SELECT password_hash, totp_secret, totp_enabled FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }

    const { password_hash, totp_secret, totp_enabled } = result.rows[0]!;

    if (!totp_enabled || !totp_secret) {
      res.status(400).json({ error: "mfa_not_enabled" });
      return;
    }

    let passwordValid = false;
    try {
      passwordValid = await argon2.verify(password_hash, String(passwordRaw));
    } catch {
      passwordValid = false;
    }

    if (!passwordValid) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const secret    = decryptSecret(totp_secret);
    const { valid } = verifySync({ token: codeStr, secret, ...TOTP_OPTS });

    if (!valid) {
      res.status(400).json({ error: "invalid_code" });
      return;
    }

    await pg.query(
      `UPDATE users
       SET totp_secret = NULL, totp_enabled = false, totp_backup_codes = '{}', updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );

    writeAuditEvent({
      organizationId: req.jwtPayload!.org,
      actorUserId:    userId,
      eventType:      "auth.mfa_disabled",
      resourceType:   "user",
      resourceId:     userId,
      ipAddress:      req.ip ?? null
    });

    logger.info({ event: "mfa_disabled", userId }, "MFA disabled");

    res.status(200).json({ success: true });
  } catch (err) {
    logger.error({ event: "mfa_disable_failed", err }, "POST /api/auth/mfa/disable failed");
    res.status(500).json({ error: "disable_failed" });
  }
});

/* =========================================================
   DELETE /api/auth/mfa/reset/:userId
   Requires: session JWT + admin role
   ========================================================= */

router.delete("/auth/mfa/reset/:userId", requireAuth, requireAdminRole, async (req, res) => {
  try {
    const actorId      = req.jwtPayload!.sub;
    const actorOrgId   = req.jwtPayload!.org;
    const targetUserId = String(req.params["userId"] ?? "");

    if (!targetUserId) {
      res.status(400).json({ error: "user_id_required" });
      return;
    }

    const result = await pg.query<{ id: string; organization_id: string }>(
      `SELECT id, organization_id FROM users WHERE id = $1 LIMIT 1`,
      [targetUserId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }

    if (result.rows[0]!.organization_id !== actorOrgId) {
      res.status(403).json({ error: "forbidden" });
      return;
    }

    await pg.query(
      `UPDATE users
       SET totp_secret = NULL, totp_enabled = false, totp_backup_codes = '{}', updated_at = NOW()
       WHERE id = $1`,
      [targetUserId]
    );

    writeAuditEvent({
      organizationId: actorOrgId,
      actorUserId:    actorId,
      eventType:      "auth.mfa_admin_reset",
      resourceType:   "user",
      resourceId:     targetUserId,
      payload:        { target_user_id: targetUserId },
      ipAddress:      req.ip ?? null
    });

    logger.info({ event: "mfa_admin_reset", actorId, targetUserId }, "Admin reset MFA for user");

    res.status(200).json({ success: true });
  } catch (err) {
    logger.error({ event: "mfa_admin_reset_failed", err }, "DELETE /api/auth/mfa/reset failed");
    res.status(500).json({ error: "reset_failed" });
  }
});

export default router;
