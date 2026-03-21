import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";

import {
  recordAdminAuthFailure,
  clearAdminAuthFailures
} from "./adminLockout.js";

const MAX_ADMIN_KEY_LENGTH = 256;
const MIN_ADMIN_KEY_LENGTH = 16;
const MAX_ROTATED_KEYS = 10;

function safeEqualUtf8(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");

  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function loadAdminKeys(): string[] {
  const raw = process.env.SECURELOGIC_ADMIN_KEY;

  if (!raw || raw.trim() === "") return [];

  const keys = raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  if (keys.length === 0) return [];
  if (keys.length > MAX_ROTATED_KEYS) return [];

  for (const k of keys) {
    if (k.length < MIN_ADMIN_KEY_LENGTH) return [];
    if (k.length > MAX_ADMIN_KEY_LENGTH) return [];
  }

  return keys;
}

function readSingleAdminHeader(req: Request): string | null {
  const raw = req.get("x-admin-key");

  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.includes(",")) return null;

  return trimmed;
}

export async function requireAdminKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const adminKeys = loadAdminKeys();

  if (adminKeys.length === 0) {
    res.status(500).json({ error: "server_misconfigured" });
    return;
  }

  const got = readSingleAdminHeader(req);

  if (!got) {
    await recordAdminAuthFailure(req);
    res.status(401).json({ error: "admin_unauthorized" });
    return;
  }

  if (got.length < MIN_ADMIN_KEY_LENGTH || got.length > MAX_ADMIN_KEY_LENGTH) {
    await recordAdminAuthFailure(req);
    res.status(401).json({ error: "admin_unauthorized" });
    return;
  }

  let match = false;

  for (const expected of adminKeys) {
    if (expected.length === got.length && safeEqualUtf8(got, expected)) {
      match = true;
    } else {
      safeEqualUtf8(got, got);
    }
  }

  if (!match) {
    await recordAdminAuthFailure(req);
    res.status(401).json({ error: "admin_unauthorized" });
    return;
  }

  await clearAdminAuthFailures(req);
  next();
}
