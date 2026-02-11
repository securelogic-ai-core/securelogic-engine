const REQUIRED_ENV_PROD = [
  "NODE_ENV",
  "REDIS_URL",
  "SECURELOGIC_ADMIN_KEY",
  "SECURELOGIC_SIGNING_SECRET",
  "LEMON_WEBHOOK_SECRET",
  "SECURELOGIC_ADMIN_ALLOWED_IPS"
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
    validateDevEntitlementsJson();
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Environment validation failed";

    console.error("❌ Environment validation failed:");
    console.error(`   ${msg}`);
    console.error("");
    console.error("Required in production:");
    for (const k of REQUIRED_ENV_PROD) console.error(`   - ${k}`);

    console.error("");
    console.error("Optional:");
    for (const k of OPTIONAL_ENV) console.error(`   - ${k}`);

    process.exit(1); // FAIL CLOSED
  }
}