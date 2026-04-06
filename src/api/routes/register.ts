import { Router } from "express";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";

const router = Router();

/* =========================================================
   RATE LIMIT
   Tighter than the global limiter — this is a public mutating
   endpoint that creates database rows without authentication.
   5 registrations per IP per hour.
   ========================================================= */

const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "registration_rate_limit_exceeded" }
});

/* =========================================================
   HELPERS
   ========================================================= */

function generateApiKey(): string {
  // sl_ + 32 lowercase hex chars — consistent with adminApiKeys.ts format
  return "sl_" + crypto.randomBytes(16).toString("hex");
}

function slugify(name: string, suffix: string): string {
  // Lowercase, replace non-alphanumeric runs with hyphens, append suffix
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return `${base}-${suffix}`;
}

function isValidEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 254) return false;
  // RFC 5322 simplified — reject obviously invalid addresses
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function isValidOrgName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.length <= 100;
}

/* =========================================================
   POST /api/register

   Public endpoint — no API key required.

   Creates an organization and a starter-tier API key in a
   single transaction. Returns the raw API key once — it is
   hashed in the DB and never retrievable again.

   Body: { name: string, email: string }

   Rate limited: 5 requests per IP per hour.
   ========================================================= */

router.post("/register", registrationLimiter, async (req, res) => {
  try {
    const nameRaw = req.body?.name;
    const emailRaw = req.body?.email;

    if (!isValidOrgName(nameRaw)) {
      res.status(400).json({
        error: "invalid_org_name",
        detail: "name must be 2–100 characters"
      });
      return;
    }

    if (!isValidEmail(emailRaw)) {
      res.status(400).json({
        error: "invalid_email",
        detail: "a valid email address is required"
      });
      return;
    }

    const name = String(nameRaw).trim();
    const email = String(emailRaw).trim().toLowerCase();

    // Generate org slug: slugified name + 6-char random suffix for uniqueness
    const slugSuffix = crypto.randomBytes(3).toString("hex"); // e.g. "a3f1c8"
    const slug = slugify(name, slugSuffix);

    // Generate raw API key — returned once to the caller
    const rawKey = generateApiKey();
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");

    // Create org + API key atomically
    const client = await pg.connect();

    let orgId: string;
    let keyId: string;

    try {
      await client.query("BEGIN");

      const orgResult = await client.query(
        `
        INSERT INTO organizations (name, slug, plan, status)
        VALUES ($1, $2, 'starter', 'active')
        RETURNING id
        `,
        [name, slug]
      );

      orgId = orgResult.rows[0].id as string;

      const keyResult = await client.query(
        `
        INSERT INTO api_keys (organization_id, label, key_hash, entitlement_level, status)
        VALUES ($1, $2, $3, 'starter', 'active')
        RETURNING id
        `,
        [orgId, email, keyHash]
      );

      keyId = keyResult.rows[0].id as string;

      // Enroll the registrant as a free-tier newsletter subscriber.
      // ON CONFLICT DO NOTHING preserves an existing paid tier if the email
      // was already subscribed before registration.
      await client.query(
        `
        INSERT INTO subscribers (email, tier, status, created_at)
        VALUES ($1, 'free', 'active', NOW())
        ON CONFLICT (email) DO NOTHING
        `,
        [email]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    logger.info(
      {
        event: "registration_complete",
        organizationId: orgId,
        apiKeyId: keyId,
        keyPrefix: rawKey.slice(0, 6)
      },
      "New organization and API key registered"
    );

    // The raw key is returned exactly once. It is not stored and cannot be
    // retrieved again. The caller must persist it immediately.
    res.status(201).json({
      ok: true,
      apiKey: rawKey,
      organizationId: orgId,
      entitlementLevel: "starter",
      note: "Store your API key immediately — it will not be shown again."
    });
  } catch (err) {
    logger.error({ event: "registration_failed", err }, "POST /api/register failed");
    res.status(500).json({ error: "registration_failed" });
  }
});

export default router;
