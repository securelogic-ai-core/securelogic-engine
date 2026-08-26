/**
 * portalExchangeRateLimiter.ts — the limit on the ONE unauthenticated portal
 * endpoint (VA-S1a).
 *
 * `POST /api/vendor-portal/session` is the only route in the product that a
 * caller holding no credential at all can reach and make do work: it hashes a
 * token, probes `vendor_engagement_invites`, and on success writes two rows.
 * `requirePortalSession`'s DB-backed limiter protects every route AFTER a
 * session exists and by construction cannot protect the route that CREATES one.
 * The exchange had no limit at all.
 *
 * ── What it counts, and why that is not "requests per IP" ───────────────────
 *
 * Per address it counts FAILURES, not attempts. A whole vendor office behind
 * one NAT address legitimately exchanges valid links all day; throttling that
 * would break honest users while barely inconveniencing an attacker, which is
 * the same reasoning `vendor_portal_sessions` already applies to fingerprint
 * drift. What no honest caller does is present tokens that do not resolve.
 *
 * A global per-minute ceiling on ATTEMPTS sits behind it, because a spray from
 * many addresses never trips a per-address rule.
 *
 * What this defends against, stated honestly:
 *
 *   NOT token guessing. The invite token is 256 bits of CSPRNG output resolved
 *   through a unique hash index. No rate limit is what makes that infeasible,
 *   and implying otherwise would be theatre.
 *
 *   YES unauthenticated work amplification — an anonymous flood becoming a hash
 *   + index probe + log line per request — and the operator signal that comes
 *   from a named 429 rather than a silent load spike.
 *
 * ── Why in-process, and the residual limitation ─────────────────────────────
 *
 * The counters live in this process. Redis, when connected, is consulted as a
 * SHARED second opinion so several instances enforce one number instead of one
 * each — but a Redis outage can only make this limiter COARSER, never absent.
 * That is deliberately the opposite of apiRateLimiter.ts, which calls `next()`
 * when `redisReady` is false: a defensible trade for authenticated API keys and
 * the wrong one on a public endpoint.
 *
 * The residual limitation, stated rather than papered over: with N instances
 * and Redis down, the effective ceiling is N× these numbers. Removing that
 * permanently means a durable counter — the shape
 * `vendor_portal_sessions.request_count` already uses — which needs a table an
 * unauthenticated caller may write. That is a schema decision, out of scope for
 * a schema-free package, and recorded as a follow-up rather than pretended away.
 */

import type { NextFunction, Request, Response } from "express";

import { ensureRedisConnected, redisReady } from "../infra/redis.js";
import { logger } from "../infra/logger.js";

/** Failed exchanges per minute from one address before it is shut out. */
export const PORTAL_EXCHANGE_FAILURE_LIMIT_PER_IP = 10;
/** Exchange attempts per minute this process will serve from all addresses. */
export const PORTAL_EXCHANGE_LIMIT_GLOBAL = 300;
/** Distinct failing addresses tracked per window before new ones are shed. */
const MAX_TRACKED_ADDRESSES = 20_000;

const WINDOW_MS = 60_000;
const REDIS_TIMEOUT_MS = 1200;

type WindowState = { windowId: number; attempts: number; failuresByAddress: Map<string, number> };

const state: WindowState = { windowId: -1, attempts: 0, failuresByAddress: new Map() };

function currentWindowId(now: number): number {
  return Math.floor(now / WINDOW_MS);
}

/** Rotating the window is what bounds memory: the map is dropped, not pruned. */
function rollWindow(now: number): void {
  const id = currentWindowId(now);
  if (id !== state.windowId) {
    state.windowId = id;
    state.attempts = 0;
    state.failuresByAddress = new Map();
  }
}

/** Test seam — the module is a singleton and vitest keeps it between cases. */
export function resetPortalExchangeLimiter(): void {
  state.windowId = -1;
  state.attempts = 0;
  state.failuresByAddress = new Map();
}

export type ExchangeLimitDecision =
  | { allowed: true }
  | { allowed: false; scope: "ip" | "global" };

/** Pure admission step. Exported so the limits are testable without Express. */
export function checkExchangeAttempt(
  address: string,
  now: number = Date.now()
): ExchangeLimitDecision {
  rollWindow(now);

  state.attempts += 1;
  if (state.attempts > PORTAL_EXCHANGE_LIMIT_GLOBAL) return { allowed: false, scope: "global" };

  const failures = state.failuresByAddress.get(address) ?? 0;
  if (failures > PORTAL_EXCHANGE_FAILURE_LIMIT_PER_IP) return { allowed: false, scope: "ip" };

  return { allowed: true };
}

/**
 * Called by the exchange handler on every rejected token. Success costs an
 * address nothing — that is the point.
 */
export function recordExchangeFailure(address: string, now: number = Date.now()): void {
  rollWindow(now);
  const seen = state.failuresByAddress.get(address);
  if (seen === undefined && state.failuresByAddress.size >= MAX_TRACKED_ADDRESSES) {
    // Out of room to remember this address. The global attempt ceiling is the
    // remaining protection; dropping the entry silently is better than evicting
    // an address that is actively failing.
    return;
  }
  state.failuresByAddress.set(address, (seen ?? 0) + 1);
  void recordSharedFailure(address, now);
}

function sharedKey(address: string, now: number): string {
  return `portal:exchange:fail:${address}:${currentWindowId(now)}`;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => {
      const t = setTimeout(() => resolve(null), ms);
      t.unref?.();
    }),
  ]);
}

async function recordSharedFailure(address: string, now: number): Promise<void> {
  if (!redisReady) return;
  try {
    const redis = await ensureRedisConnected();
    await withTimeout(
      redis.multi().incr(sharedKey(address, now)).expire(sharedKey(address, now), 120).exec(),
      REDIS_TIMEOUT_MS
    );
  } catch {
    // Best effort. The in-process counter is the floor, never the ceiling.
  }
}

/**
 * Shared count, best effort. Can only ever ADD a rejection: any Redis problem
 * returns false and leaves the in-process decision standing.
 */
async function sharedFailureLimitExceeded(address: string, now: number): Promise<boolean> {
  if (!redisReady) return false;
  try {
    const redis = await ensureRedisConnected();
    const raw = await withTimeout(redis.get(sharedKey(address, now)), REDIS_TIMEOUT_MS);
    const count = Number(raw);
    return Number.isFinite(count) && count > PORTAL_EXCHANGE_FAILURE_LIMIT_PER_IP;
  } catch {
    return false;
  }
}

function refuse(res: Response, scope: string, address: string): void {
  logger.warn(
    { event: "portal_exchange_rate_limited", scope, address },
    "Vendor-portal invite exchange rate limited"
  );
  res.setHeader("Retry-After", "60");
  // The same wording the session limiter uses, and it says nothing about
  // whether any token was real: a limiter must not become the oracle the
  // exchange route is carefully built not to be.
  res.status(429).json({
    error: "rate_limit_exceeded",
    message: "Too many requests. Please wait a moment and try again.",
  });
}

export async function portalExchangeRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const address = req.ip ?? "unknown";
  const now = Date.now();

  const local = checkExchangeAttempt(address, now);
  if (!local.allowed) {
    refuse(res, local.scope, address);
    return;
  }

  if (await sharedFailureLimitExceeded(address, now)) {
    refuse(res, "shared", address);
    return;
  }

  next();
}
