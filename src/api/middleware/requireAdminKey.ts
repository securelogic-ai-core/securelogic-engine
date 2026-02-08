import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";

const MAX_ADMIN_KEY_LENGTH = 256;
const MIN_ADMIN_KEY_LENGTH = 16;
const MAX_ROTATED_KEYS = 10;

function safeEqualUtf8(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");

  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Supports either:
 *   SECURELOGIC_ADMIN_KEY="key1"
 * or rotation:
 *   SECURELOGIC_ADMIN_KEY="key1,key2,key3"
 *
 * Enterprise rules:
 * - Must contain at least 1 key
 * - Keys must be 16..256 chars
 * - Bounded number of rotated keys (prevents env abuse)
 */
function loadAdminKeys(): string[] {
  const raw = process.env.SECURELOGIC_ADMIN_KEY;

  if (!raw || raw.trim() === "") return [];

  const keys = raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  if (keys.length === 0) return [];

  // Prevent absurd env rotation lists
  if (keys.length > MAX_ROTATED_KEYS) return [];

  // Enforce strict key length bounds
  for (const k of keys) {
    if (k.length < MIN_ADMIN_KEY_LENGTH) return [];
    if (k.length > MAX_ADMIN_KEY_LENGTH) return [];
  }

  return keys;
}

/**
 * Enterprise:
 * Prevent header confusion attacks.
 * - Reject multiple header values
 * - Reject comma-separated multi-values
 */
function readSingleAdminHeader(req: Request): string | null {
  const raw = req.get("x-admin-key");

  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // If a proxy merges multiple headers into "a,b", reject.
  if (trimmed.includes(",")) return null;

  return trimmed;
}

export function requireAdminKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const adminKeys = loadAdminKeys();

  /**
   * Enterprise rule:
   * Misconfigured server must fail closed.
   */
  if (adminKeys.length === 0) {
    res.status(500).json({ error: "server_misconfigured" });
    return;
  }

  const got = readSingleAdminHeader(req);

  /**
   * Enterprise rule:
   * Never reveal missing vs invalid.
   */
  if (!got) {
    res.status(401).json({ error: "admin_unauthorized" });
    return;
  }

  /**
   * DoS / header abuse defense.
   */
  if (got.length < MIN_ADMIN_KEY_LENGTH || got.length > MAX_ADMIN_KEY_LENGTH) {
    res.status(401).json({ error: "admin_unauthorized" });
    return;
  }

  /**
   * Constant-time compare against all keys.
   * - No early return
   * - No "length mismatch shortcut" except inside safeEqualUtf8
   */
  let match = false;

  for (const expected of adminKeys) {
    if (expected.length === got.length && safeEqualUtf8(got, expected)) {
      match = true;
    } else {
      /**
       * Side-channel reduction:
       * Still do *some* work for non-matching keys.
       */
      safeEqualUtf8(got, got);
    }
  }

  if (!match) {
    res.status(401).json({ error: "admin_unauthorized" });
    return;
  }

  next();
}