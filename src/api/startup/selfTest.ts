import crypto from "crypto";
import { redisReady } from "../infra/redis.js";
import { logger } from "../infra/logger.js";
import { pgTlsVerificationDisabled } from "../infra/pgSsl.js";

function fail(msg: string): never {
  logger.fatal({ msg }, "Boot self-test failed (fail-closed)");

  /**
   * Boot-time failures MUST be visible even if logging is misconfigured.
   */
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

function assertMaxLength(key: string, max: number): void {
  const v = process.env[key] ?? "";
  assert(v.length <= max, `${key} must be <= ${max} characters`);
}

function assertProdHardening(): void {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) return;

  /**
   * P0-1: database TLS verification is the default. The rollback hatch
   * (DATABASE_TLS_NO_VERIFY) must stay USABLE in production — it exists so a
   * verification failure is recoverable with an env flip instead of a code
   * revert, and an assert here would brick that path. So it does not fail the
   * boot; it screams: an error-level line on every boot until the hatch is
   * removed. An open incident is the only legitimate reason to see this.
   */
  if (pgTlsVerificationDisabled()) {
    logger.error(
      { event: "pg_tls_verification_disabled" },
      "DATABASE_TLS_NO_VERIFY is set: Postgres TLS is UNAUTHENTICATED. " +
        "This is the P0-1 incident rollback hatch and must not persist."
    );
  }

  /**
   * Production MUST have Redis.
   */
  assert(redisReady === true, "Redis must be configured in production");

  /**
   * Production MUST have secrets.
   */
  assertNonEmptyEnv("SECURELOGIC_ADMIN_KEY");

  /**
   * Production MUST have an admin network allowlist configured.
   *
   * This assertion previously carried the note "/admin is fail-closed if this
   * is missing", which was FALSE for as long as it existed: requireAdminNetwork
   * was never mounted, so nothing read the value and /admin was restricted by
   * key possession alone. The middleware is now first in adminChain, so the
   * value is finally consumed — but it only REJECTS when
   * SECURELOGIC_ADMIN_NETWORK_ENFORCED="true".
   *
   * So the accurate statement is: with enforcement on, an empty allowlist makes
   * /admin fail closed (500 server_misconfigured); with enforcement off, this
   * value is evaluated and logged but refuses nothing. Keeping the assertion
   * either way is right — the list must be correct BEFORE it is switched on.
   */
  assertNonEmptyEnv("SECURELOGIC_ADMIN_ALLOWED_IPS");

  /**
   * Prevent weak secrets.
   */
  assertMinLength("SECURELOGIC_ADMIN_KEY", 16);

  /**
   * Prevent absurdly oversized envs (header/env abuse / misconfig).
   */
  assertMaxLength("SECURELOGIC_ADMIN_KEY", 4096);
  assertMaxLength("SECURELOGIC_ADMIN_ALLOWED_IPS", 4096);

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

  /**
   * Prevent insecure admin allowlist patterns.
   */
  const allowRaw = process.env.SECURELOGIC_ADMIN_ALLOWED_IPS ?? "";
  const allowParts = allowRaw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  assert(
    allowParts.length >= 1,
    "SECURELOGIC_ADMIN_ALLOWED_IPS parsed into 0 entries"
  );

  /**
   * Hard ban: open-to-world CIDR.
   */
  for (const p of allowParts) {
    const lower = p.toLowerCase();

    assert(
      lower !== "0.0.0.0/0",
      "SECURELOGIC_ADMIN_ALLOWED_IPS contains 0.0.0.0/0 (FORBIDDEN)"
    );

    assert(
      lower !== "::/0",
      "SECURELOGIC_ADMIN_ALLOWED_IPS contains ::/0 (FORBIDDEN)"
    );
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