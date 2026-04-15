import { Router } from "express";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { Resend } from "resend";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { ensureRedisConnected } from "../infra/redis.js";

const router = Router();

/* =========================================================
   RATE LIMITS
   ========================================================= */

/** 10 recovery requests per IP per minute — prevents email spam */
const requestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "recovery_rate_limit_exceeded" }
});

/** 10 claim attempts per IP per minute — prevents brute-force on tokens */
const claimLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "recovery_rate_limit_exceeded" }
});

/* =========================================================
   CONSTANTS
   ========================================================= */

const TOKEN_TTL_SECONDS = 900; // 15 minutes
const REDIS_PREFIX = "recovery_token:";

/* =========================================================
   HELPERS
   ========================================================= */

function isValidEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function generateApiKey(): string {
  return "sl_" + crypto.randomBytes(16).toString("hex");
}

function generateToken(): string {
  return crypto.randomBytes(24).toString("hex"); // 48 hex chars
}

function getResend(): Resend {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new Error("RESEND_API_KEY not set");
  return new Resend(key);
}

function getFromAddress(): string {
  const from = process.env.NEWSLETTER_FROM_EMAIL?.trim();
  if (!from) throw new Error("NEWSLETTER_FROM_EMAIL not set");
  return from;
}

function buildRecoveryUrl(token: string): string | null {
  const base = process.env.APP_BASE_URL?.trim();
  if (!base) return null;
  return `${base}/recover/confirm?token=${token}`;
}

/* =========================================================
   POST /api/account/recovery/request
   { email: string }

   Public — no API key required. Rate-limited.

   Looks up the active API key for the given email, generates
   a short-lived recovery token in Redis, and sends a magic-link
   email via Resend.

   Always responds { ok: true } — never reveals whether the
   email is registered (security: enumeration prevention).
   ========================================================= */

router.post("/account/recovery/request", requestLimiter, async (req, res) => {
  // Always respond ok — do not reveal whether email is registered
  const respond = () => res.status(200).json({ ok: true });

  try {
    const emailRaw = req.body?.email;

    if (!isValidEmail(emailRaw)) {
      // Return ok even for invalid input — no enumeration
      respond();
      return;
    }

    const email = String(emailRaw).trim().toLowerCase();

    // Look up active API key by label (label stores the registration email)
    const result = await pg.query(
      `SELECT id FROM api_keys WHERE LOWER(label) = $1 AND status = 'active' LIMIT 1`,
      [email]
    );

    if (result.rows.length === 0) {
      // No account found — respond ok silently
      logger.info(
        { event: "recovery_request_no_account", email },
        "accountRecovery: no active key for email — silent ok"
      );
      respond();
      return;
    }

    const apiKeyId = result.rows[0].id as string;
    const token = generateToken();

    // Store token → api_key_id in Redis with 15-minute TTL
    const redis = await ensureRedisConnected();
    await redis.set(`${REDIS_PREFIX}${token}`, apiKeyId, { EX: TOKEN_TTL_SECONDS });

    logger.info(
      { event: "recovery_token_created", apiKeyId },
      "accountRecovery: recovery token created"
    );

    // Build recovery URL
    const recoveryUrl = buildRecoveryUrl(token);

    if (!recoveryUrl) {
      logger.warn(
        { event: "recovery_no_base_url", apiKeyId },
        "accountRecovery: APP_BASE_URL not set — cannot send recovery email"
      );
      respond();
      return;
    }

    // Validate Resend is configured before attempting send
    if (!process.env.RESEND_API_KEY?.trim() || !process.env.NEWSLETTER_FROM_EMAIL?.trim()) {
      logger.warn(
        { event: "recovery_email_not_configured", apiKeyId },
        "accountRecovery: RESEND_API_KEY or NEWSLETTER_FROM_EMAIL not set — recovery email not sent"
      );
      respond();
      return;
    }

    // Send email via Resend
    try {
      const resend = getResend();
      const from = getFromAddress();

      await resend.emails.send({
        from,
        to: email,
        subject: "SecureLogic — Sign in to your account",
        html: `
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
  <p style="font-size:16px;font-weight:600;color:#0f172a;margin:0 0 8px;">Sign in to SecureLogic AI</p>
  <p style="font-size:14px;color:#475569;margin:0 0 24px;">
    Click the button below to sign in. This link expires in 15 minutes and can only be used once.
  </p>
  <a href="${recoveryUrl}"
     style="display:inline-block;background:#0d9488;color:#ffffff;font-size:14px;font-weight:600;
            text-decoration:none;padding:12px 24px;border-radius:8px;">
    Sign In to Your Account
  </a>
  <p style="font-size:12px;color:#94a3b8;margin:24px 0 0;">
    If you did not request this, you can safely ignore this email.<br>
    This link will expire at ${new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toUTCString()}.
  </p>
</div>`,
      });

      logger.info(
        { event: "recovery_email_sent", apiKeyId },
        "accountRecovery: recovery email sent"
      );
    } catch (emailErr) {
      logger.error(
        { event: "recovery_email_failed", apiKeyId, err: emailErr },
        "accountRecovery: failed to send recovery email (non-fatal)"
      );
    }

    respond();
  } catch (err) {
    logger.error(
      { event: "recovery_request_failed", err },
      "accountRecovery: unhandled error in request handler"
    );
    respond(); // Always ok — do not leak internal errors
  }
});

/* =========================================================
   POST /api/account/recovery/claim
   { token: string }

   Public — no API key required. Rate-limited.

   Validates the recovery token from Redis, generates a new
   API key for the associated account, invalidates the token,
   and returns the new raw API key once.
   ========================================================= */

router.post("/account/recovery/claim", claimLimiter, async (req, res) => {
  try {
    const tokenRaw = req.body?.token;
    const token = typeof tokenRaw === "string" ? tokenRaw.trim() : null;

    if (!token || token.length < 8 || token.length > 128) {
      res.status(400).json({ error: "invalid_token" });
      return;
    }

    // Look up token in Redis
    const redis = await ensureRedisConnected();
    const apiKeyId = await redis.get(`${REDIS_PREFIX}${token}`);

    if (!apiKeyId) {
      res.status(404).json({ error: "token_not_found_or_expired" });
      return;
    }

    // Delete token immediately — single-use
    await redis.del(`${REDIS_PREFIX}${token}`);

    // Verify key still exists and is active
    const existing = await pg.query(
      `SELECT id, status FROM api_keys WHERE id = $1 LIMIT 1`,
      [apiKeyId]
    );

    if (existing.rows.length === 0 || existing.rows[0].status !== "active") {
      logger.warn(
        { event: "recovery_claim_key_inactive", apiKeyId },
        "accountRecovery: key no longer active at claim time"
      );
      res.status(404).json({ error: "account_not_found" });
      return;
    }

    // Generate new API key and update key_hash (rekey)
    const newRawKey = generateApiKey();
    const newKeyHash = crypto.createHash("sha256").update(newRawKey).digest("hex");

    await pg.query(
      `UPDATE api_keys SET key_hash = $1 WHERE id = $2`,
      [newKeyHash, apiKeyId]
    );

    logger.info(
      { event: "recovery_claim_success", apiKeyId },
      "accountRecovery: API key rekeyed via recovery claim"
    );

    res.status(200).json({ ok: true, apiKey: newRawKey });
  } catch (err) {
    logger.error(
      { event: "recovery_claim_failed", err },
      "accountRecovery: unhandled error in claim handler"
    );
    res.status(500).json({ error: "recovery_failed" });
  }
});

export default router;
