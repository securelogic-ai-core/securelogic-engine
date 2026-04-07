import { logger } from "../infra/logger.js";

const REQUIRED_ENV_PROD = [
  "NODE_ENV",
  "DATABASE_URL",
  "REDIS_URL",
  "SESSION_SECRET",
  "SECURELOGIC_ADMIN_KEY",
  "SECURELOGIC_SIGNING_SECRET",
  "LEMON_WEBHOOK_SECRET",
  "SECURELOGIC_ADMIN_ALLOWED_IPS",
  "UNSUBSCRIBE_SECRET",
  "RESEND_WEBHOOK_SECRET",
  // Stripe billing — required; billing routes return 503 without these
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_ID_PROFESSIONAL",
  "STRIPE_PRICE_ID_TEAM",
  "STRIPE_SUCCESS_URL",
  "STRIPE_CANCEL_URL",
  "STRIPE_PORTAL_RETURN_URL",
  // Required for CAN-SPAM compliant unsubscribe links in outbound emails
  "APP_BASE_URL"
] as const;

const OPTIONAL_ENV = [
  "LOG_LEVEL",
  "SECURELOGIC_ENTITLEMENTS", // dev-only fallback
  "PORT",
  "SECURELOGIC_DISABLE_PUBLIC_API",
  "ENABLE_DEBUG_ROUTES",
  "ALLOW_ADMIN_TIER_ASSIGNMENT"
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

function validateWebhookSecret(): void {
  const secret = process.env.LEMON_WEBHOOK_SECRET;
  if (!isNonEmptyString(secret)) return;

  if (secret.trim().length < 16) {
    throw new Error("LEMON_WEBHOOK_SECRET must be at least 16 characters");
  }

  if (secret.trim().length > 512) {
    throw new Error("LEMON_WEBHOOK_SECRET must be <= 512 characters");
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

  // Stripe is optional — warn if partially configured
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
    assertMaxLength("LEMON_WEBHOOK_SECRET", 4096);
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

    validateRedisUrl();
    validateAdminKey();
    validateSigningSecret();
    validateWebhookSecret();
    validateAdminAllowlist();
    validateResendWebhookSecret();
    validateUnsubscribeSecret();
    validateStripeEnv();
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