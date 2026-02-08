import crypto from "crypto";
import { redisReady } from "../infra/redis.js";
import { logger } from "../infra/logger.js";

function fail(msg: string): never {
  logger.fatal({ msg }, "Boot self-test failed (fail-closed)");

  // Boot-time failures MUST be visible even if logging is misconfigured.
  console.error(`❌ Boot self-test failed: ${msg}`);

  process.exit(1);
}

function assert(condition: unknown, msg: string): void {
  if (!condition) fail(msg);
}

function assertNonEmptyEnv(key: string): void {
  const v = process.env[key];
  assert(typeof v === "string" && v.trim().length > 0, `${key} missing/empty`);
}

function assertMinLength(key: string, min: number): void {
  const v = process.env[key] ?? "";
  assert(v.length >= min, `${key} must be at least ${min} characters`);
}

function assertProdHardening(): void {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) return;

  /**
   * Production MUST have Redis.
   */
  assert(redisReady === true, "Redis must be configured in production");

  /**
   * Production MUST have secrets.
   */
  assertNonEmptyEnv("SECURELOGIC_ADMIN_KEY");
  assertNonEmptyEnv("LEMON_WEBHOOK_SECRET");

  /**
   * Prevent weak secrets.
   */
  assertMinLength("SECURELOGIC_ADMIN_KEY", 16);
  assertMinLength("LEMON_WEBHOOK_SECRET", 16);

  /**
   * Admin key rotation support sanity check.
   * SECURELOGIC_ADMIN_KEY may contain comma-separated keys.
   */
  const rawAdmin = process.env.SECURELOGIC_ADMIN_KEY ?? "";
  const keys = rawAdmin
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  assert(keys.length >= 1, "SECURELOGIC_ADMIN_KEY parsed into 0 keys");

  for (const k of keys) {
    assert(k.length >= 16, "SECURELOGIC_ADMIN_KEY contains weak key");
    assert(k.length <= 256, "SECURELOGIC_ADMIN_KEY contains oversized key");
  }
}

function assertCryptoAvailable(): void {
  /**
   * Sanity: ensure crypto is available and timingSafeEqual works.
   */
  const a = crypto.randomBytes(32);
  const b = Buffer.from(a);

  assert(
    crypto.timingSafeEqual(a, b) === true,
    "crypto.timingSafeEqual not working"
  );
}

export function runSelfTest(): void {
  assertCryptoAvailable();
  assertProdHardening();

  logger.info(
    {
      nodeEnv: process.env.NODE_ENV ?? null,
      redisReady
    },
    "Boot self-test passed"
  );
}