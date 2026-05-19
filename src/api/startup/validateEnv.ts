import { logger } from "../infra/logger.js";

const REQUIRED_ENV_PROD = [
  "NODE_ENV",
  "DATABASE_URL",
  "REDIS_URL",
  "SECURELOGIC_ADMIN_KEY",
  "SECURELOGIC_SIGNING_SECRET",
  "SECURELOGIC_ADMIN_ALLOWED_IPS",
  "UNSUBSCRIBE_SECRET",
  "RESEND_WEBHOOK_SECRET",
  // Stripe billing — required; billing routes return 503 without these
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_ID_PROFESSIONAL",
  "STRIPE_PRICE_ID_TEAMS",
  "STRIPE_PRICE_ID_PLATFORM",
  "STRIPE_PRICE_ID_PLATFORM_ANNUAL",
  "STRIPE_SUCCESS_URL",
  "STRIPE_CANCEL_URL",
  "STRIPE_PORTAL_RETURN_URL",
  // Required for CAN-SPAM compliant unsubscribe links in outbound emails
  "APP_BASE_URL",
  // Required for outbound Intelligence Brief emails — must be a verified Resend sender
  "BRIEF_FROM_EMAIL",
  // Required for CAN-SPAM compliant unsubscribe links in Brief emails
  "BRIEF_UNSUBSCRIBE_BASE_URL",
  // Required for customer portal JWT signing (email/password auth)
  "JWT_SECRET"
] as const;

const OPTIONAL_ENV = [
  "LOG_LEVEL",
  "SECURELOGIC_ENTITLEMENTS", // dev-only fallback
  "PORT",
  "SECURELOGIC_DISABLE_PUBLIC_API",
  "ENABLE_DEBUG_ROUTES",
  "ALLOW_ADMIN_TIER_ASSIGNMENT",
  // Resend — required for recovery emails.
  // Optional at startup for the main API: if absent, recovery requests are
  // accepted but no email is sent and a warning is logged.
  // NOTE: NEWSLETTER_FROM_EMAIL is also required by the intelligence-worker;
  // that service validates it at its own startup (runner.ts).
  "RESEND_API_KEY",
  "NEWSLETTER_FROM_EMAIL",
  // AI generation — required for intelligence brief generation.
  // Optional at startup: brief generation returns 503 without it.
  "ANTHROPIC_API_KEY",
  // Scheduler — required for cron-triggered jobs.
  // Optional at startup: scheduler is disabled without it.
  "SCHEDULER_SECRET",
  // Field encryption — required in production to protect sensitive JSONB fields.
  // Optional in development: fields stored as plaintext with a warning.
  "FIELD_ENCRYPTION_KEY",
  // Brief signup — organization_id used for public marketing signups.
  // Defaults to the canonical SecureLogic brief org when not set.
  "BRIEF_ORG_ID",
  // Legacy Stripe price ID — kept for backward compatibility with old
  // "team" tier metadata still referenced by the webhook's legacy
  // tier whitelist. No new checkouts use this env var; required price
  // IDs are PROFESSIONAL, TEAMS, PLATFORM, and PLATFORM_ANNUAL.
  "STRIPE_PRICE_ID_TEAM"
] as const;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function mustBePresentInProd(key: string): void {
  const v = process.env[key];
  if (!isNonEmptyString(v)) {
    throw new Error(`Missing required env var in production: ${key}`);
  }
}

function assertMaxLength(key: string, max: number): void {
  const v = process.env[key];
  if (!isNonEmptyString(v)) return;

  if (v.length > max) {
    throw new Error(`${key} must be <= ${max} characters`);
  }
}

function validateNodeEnv(): void {
  const env = process.env.NODE_ENV;

  // Enterprise rule: must be explicitly set
  if (!isNonEmptyString(env)) {
    throw new Error(`NODE_ENV must be set to "production" or "development"`);
  }

  // Only allow known safe values
  if (env !== "production" && env !== "development" && env !== "test") {
    throw new Error(
      `NODE_ENV must be one of: production | development | test (got "${env}")`
    );
  }
}

function validateRedisUrl(): void {
  const raw = process.env.REDIS_URL;
  if (!isNonEmptyString(raw)) return;

  if (!raw.startsWith("redis://") && !raw.startsWith("rediss://")) {
    throw new Error(`REDIS_URL must start with redis:// or rediss://`);
  }
}

function validateAdminKey(): void {
  const raw = process.env.SECURELOGIC_ADMIN_KEY;
  if (!isNonEmptyString(raw)) return;

  // Supports rotation: "key1,key2"
  const keys = raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  if (keys.length === 0) {
    throw new Error("SECURELOGIC_ADMIN_KEY is present but empty after parsing");
  }

  for (const k of keys) {
    if (k.length < 16) {
      throw new Error(
        "SECURELOGIC_ADMIN_KEY contains a key shorter than 16 characters"
      );
    }
    if (k.length > 256) {
      throw new Error(
        "SECURELOGIC_ADMIN_KEY contains a key longer than 256 characters"
      );
    }
  }
}

function validateSigningSecret(): void {
  const raw = process.env.SECURELOGIC_SIGNING_SECRET;
  if (!isNonEmptyString(raw)) return;

  /**
   * IMPORTANT:
   * verifyIssueSignature.ts currently supports ONLY a single signing secret.
   * Therefore, we do NOT allow rotation lists here yet.
   *
   * When we upgrade verifyIssueSignature to allow rotation, we can allow:
   * "secret1,secret2" (newest first).
   */
  const trimmed = raw.trim();

  if (trimmed.includes(",")) {
    throw new Error(
      "SECURELOGIC_SIGNING_SECRET must be a single secret (rotation not yet supported)"
    );
  }

  if (trimmed.length < 16) {
    throw new Error("SECURELOGIC_SIGNING_SECRET must be at least 16 characters");
  }

  if (trimmed.length > 512) {
    throw new Error(
      "SECURELOGIC_SIGNING_SECRET must be <= 512 characters"
    );
  }
}

function validateAdminAllowlist(): void {
  const raw = process.env.SECURELOGIC_ADMIN_ALLOWED_IPS;
  if (!isNonEmptyString(raw)) return;

  const parts = raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    throw new Error(
      "SECURELOGIC_ADMIN_ALLOWED_IPS is present but empty after parsing"
    );
  }

  /**
   * Hard ban: open-to-world CIDR.
   * This is forbidden.
   */
  for (const p of parts) {
    const lower = p.toLowerCase();

    if (lower === "0.0.0.0/0") {
      throw new Error(
        "SECURELOGIC_ADMIN_ALLOWED_IPS contains 0.0.0.0/0 (FORBIDDEN)"
      );
    }

    if (lower === "::/0") {
      throw new Error(
        "SECURELOGIC_ADMIN_ALLOWED_IPS contains ::/0 (FORBIDDEN)"
      );
    }
  }
}

function validateResendWebhookSecret(): void {
  const raw = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!raw) return; // presence enforced by REQUIRED_ENV_PROD in production

  if (raw.length < 16) {
    throw new Error("RESEND_WEBHOOK_SECRET must be at least 16 characters");
  }

  if (raw.length > 512) {
    throw new Error("RESEND_WEBHOOK_SECRET must be <= 512 characters");
  }
}

function validateUnsubscribeSecret(): void {
  const raw = process.env.UNSUBSCRIBE_SECRET?.trim();
  if (!raw) return; // presence already enforced by REQUIRED_ENV_PROD in production

  if (raw.length < 16) {
    throw new Error("UNSUBSCRIBE_SECRET must be at least 16 characters");
  }

  if (raw.length > 512) {
    throw new Error("UNSUBSCRIBE_SECRET must be <= 512 characters");
  }
}

function validateStripeEnv(): void {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

  // Stripe vars are required in production — presence enforced by
  // REQUIRED_ENV_PROD (process exits at boot if any are missing). The
  // partial-config warnings below catch dev/staging misconfigurations
  // where vars can be independently set or unset.
  const hasKey = Boolean(key);
  const hasWebhookSecret = Boolean(webhookSecret);

  if (hasKey && !hasWebhookSecret) {
    logger.warn({ event: "stripe_partial_config", missing: "STRIPE_WEBHOOK_SECRET" }, "STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is missing — Stripe webhooks will not verify");
  }

  if (!hasKey && hasWebhookSecret) {
    logger.warn({ event: "stripe_partial_config", missing: "STRIPE_SECRET_KEY" }, "STRIPE_WEBHOOK_SECRET is set but STRIPE_SECRET_KEY is missing — Stripe billing will not function");
  }

  if (hasKey && !process.env.STRIPE_PORTAL_RETURN_URL?.trim()) {
    logger.warn({ event: "stripe_partial_config", missing: "STRIPE_PORTAL_RETURN_URL" }, "STRIPE_SECRET_KEY is set but STRIPE_PORTAL_RETURN_URL is missing — billing portal will return 503");
  }

  if (key && key.length > 512) {
    throw new Error("STRIPE_SECRET_KEY must be <= 512 characters");
  }

  if (webhookSecret && webhookSecret.length > 512) {
    throw new Error("STRIPE_WEBHOOK_SECRET must be <= 512 characters");
  }
}

function validateAnthropicApiKey(): void {
  const raw = process.env.ANTHROPIC_API_KEY?.trim();
  if (!raw) {
    logger.warn(
      { event: "anthropic_api_key_missing" },
      "ANTHROPIC_API_KEY is not set — intelligence brief generation will be unavailable"
    );
    return;
  }

  if (raw.length > 512) {
    throw new Error("ANTHROPIC_API_KEY must be <= 512 characters");
  }
}

function validateSchedulerSecret(): void {
  const isProd = process.env.NODE_ENV === "production";
  const raw = process.env.SCHEDULER_SECRET?.trim();

  if (!raw) {
    if (isProd) {
      throw new Error("SCHEDULER_SECRET is required in production (min 32 chars)");
    }
    logger.warn(
      { event: "scheduler_secret_missing" },
      "SCHEDULER_SECRET is not set — scheduler endpoints will reject all calls"
    );
    return;
  }

  if (raw.length < 32) {
    throw new Error("SCHEDULER_SECRET must be at least 32 characters");
  }

  if (raw.length > 512) {
    throw new Error("SCHEDULER_SECRET must be <= 512 characters");
  }
}

const HEX_64_RE = /^[0-9a-f]{64}$/i;

function validateFieldEncryptionKey(): void {
  const isProd = process.env.NODE_ENV === "production";
  const raw = process.env.FIELD_ENCRYPTION_KEY?.trim();

  if (!raw) {
    if (isProd) {
      throw new Error(
        "FIELD_ENCRYPTION_KEY is required in production — sensitive fields (report_json, content_json, raw_payload) must be encrypted at rest. " +
        "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
      );
    }
    logger.warn(
      { event: "field_encryption_key_missing" },
      "FIELD_ENCRYPTION_KEY is not set — sensitive JSONB fields stored as plaintext. Set this variable in production."
    );
    return;
  }

  if (!HEX_64_RE.test(raw)) {
    throw new Error(
      "FIELD_ENCRYPTION_KEY must be exactly 64 lowercase hex characters (32 random bytes). " +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
}

function validateDevEntitlementsJson(): void {
  // DEV ONLY
  if (process.env.NODE_ENV !== "development") return;

  const raw = process.env.SECURELOGIC_ENTITLEMENTS;
  if (!raw || raw.trim() === "") return;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("SECURELOGIC_ENTITLEMENTS must be a JSON object");
    }
  } catch {
    throw new Error("SECURELOGIC_ENTITLEMENTS must be valid JSON");
  }
}

/**
 * Enterprise-grade environment validation.
 *
 * RULES:
 * - Production must have all required secrets + Redis.
 * - Development can run with less (for local work).
 * - Test bypasses validation entirely.
 * - Fail closed when misconfigured.
 */
export function validateEnv(): void {
  // Tests should never hard-exit the process.
  if (process.env.NODE_ENV === "test") return;

  try {
    validateNodeEnv();

    /**
     * Fail-fast for production.
     * Do this BEFORE deeper validation so errors are obvious.
     */
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) {
      for (const key of REQUIRED_ENV_PROD) mustBePresentInProd(key);
    }

    /**
     * Prevent absurdly oversized envs (header/env abuse / misconfig).
     */
    assertMaxLength("SECURELOGIC_ADMIN_KEY", 4096);
    assertMaxLength("SECURELOGIC_SIGNING_SECRET", 4096);
    assertMaxLength("SECURELOGIC_ADMIN_ALLOWED_IPS", 4096);
    assertMaxLength("UNSUBSCRIBE_SECRET", 4096);
    assertMaxLength("RESEND_WEBHOOK_SECRET", 4096);
    assertMaxLength("REDIS_URL", 4096);

    /**
     * Optional envs also get caps (enterprise hygiene).
     */
    assertMaxLength("LOG_LEVEL", 128);
    assertMaxLength("PORT", 16);
    assertMaxLength("SECURELOGIC_DISABLE_PUBLIC_API", 16);
    assertMaxLength("ENABLE_DEBUG_ROUTES", 16);
    assertMaxLength("ALLOW_ADMIN_TIER_ASSIGNMENT", 16);
    assertMaxLength("SECURELOGIC_ENTITLEMENTS", 4096);
    assertMaxLength("BRIEF_ORG_ID", 64);
    assertMaxLength("BRIEF_FROM_EMAIL", 320);
    assertMaxLength("BRIEF_UNSUBSCRIBE_BASE_URL", 2048);
    assertMaxLength("JWT_SECRET", 512);

    validateRedisUrl();
    validateAdminKey();
    validateSigningSecret();
    validateAdminAllowlist();
    validateResendWebhookSecret();
    validateUnsubscribeSecret();
    validateStripeEnv();
    validateAnthropicApiKey();
    validateSchedulerSecret();
    validateFieldEncryptionKey();
    validateDevEntitlementsJson();
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Environment validation failed";

    logger.fatal(
      {
        event: "env_validation_failed",
        reason: msg,
        requiredInProd: REQUIRED_ENV_PROD,
        optional: OPTIONAL_ENV
      },
      "Environment validation failed — process will exit"
    );

    process.exit(1); // FAIL CLOSED
  }
}