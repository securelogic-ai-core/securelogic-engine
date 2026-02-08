const REQUIRED_ENV_PROD = [
  "NODE_ENV",
  "REDIS_URL",
  "SECURELOGIC_ADMIN_KEY",
  "LEMON_WEBHOOK_SECRET"
] as const;

const OPTIONAL_ENV = [
  "LOG_LEVEL",
  "SECURELOGIC_ENTITLEMENTS", // dev-only fallback
  "PORT"
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

function validateNodeEnv(): void {
  const env = process.env.NODE_ENV;

  // Enterprise rule: NODE_ENV must be explicitly set
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

  // Basic validation: must be redis:// or rediss://
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

function validateWebhookSecret(): void {
  const secret = process.env.LEMON_WEBHOOK_SECRET;

  if (!isNonEmptyString(secret)) return;

  // Prevent weak webhook secrets
  if (secret.trim().length < 16) {
    throw new Error("LEMON_WEBHOOK_SECRET must be at least 16 characters");
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
    validateRedisUrl();
    validateAdminKey();
    validateWebhookSecret();
    validateDevEntitlementsJson();

    const isProd = process.env.NODE_ENV === "production";

    if (isProd) {
      for (const key of REQUIRED_ENV_PROD) {
        mustBePresentInProd(key);
      }
    }
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