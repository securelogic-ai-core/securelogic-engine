/**
 * Edge-safe session policy.
 *
 * This module is imported by BOTH the Node runtime (server components, route
 * handlers via session.ts) AND the edge runtime (middleware.ts). It must not
 * import `next/headers` or any Node-only API — only `iron-session`'s standalone
 * seal/unseal primitives, which run on the Web Crypto API (`crypto.subtle`) that
 * the edge runtime provides.
 *
 * Enforcement model (PR-C1): the session cookie carries two activity claims —
 *   loginAt        — epoch seconds, stamped once and never extended  → absolute cap
 *   lastActivityAt — epoch seconds, slides forward with activity      → idle cap
 * Middleware owns these claims (stamps loginAt on first authenticated sight,
 * slides lastActivityAt), so the login/issuance routes are left untouched.
 */
import { sealData, unsealData } from "iron-session";

export const SESSION_COOKIE_NAME = "sl_session";

/** The iron-session secret. Read at request time (never baked in at build). */
export function getSessionSecret(): string | undefined {
  return process.env.SESSION_SECRET;
}

/** Idle (sliding) timeout in seconds. Default 30 min. Env: SESSION_IDLE_SECONDS. */
export function getIdleSeconds(): number {
  const raw = parseInt(process.env.SESSION_IDLE_SECONDS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 30 * 60;
}

/**
 * Absolute (non-extendable) timeout in seconds. Default 12 h.
 * Env: SESSION_ABSOLUTE_SECONDS, falling back to the legacy SESSION_TIMEOUT_SECONDS
 * so existing deployments keep their configured lifetime until the new var is set.
 */
export function getAbsoluteSeconds(): number {
  const raw = parseInt(
    process.env.SESSION_ABSOLUTE_SECONDS ?? process.env.SESSION_TIMEOUT_SECONDS ?? "",
    10
  );
  return Number.isFinite(raw) && raw > 0 ? raw : 12 * 60 * 60;
}

/**
 * Only re-seal the sliding cookie once activity is at least this stale, so a
 * burst of navigations does not emit a Set-Cookie on every request. 60 s of
 * imprecision is immaterial against a 30-minute idle window.
 */
const SLIDE_THROTTLE_SECONDS = 60;

export type SessionExpiryReason = "idle" | "absolute" | "invalid";

export interface SessionActivityClaims {
  loginAt?: unknown;
  lastActivityAt?: unknown;
}

export interface SessionDecision {
  status: "valid" | "expired";
  reason?: SessionExpiryReason;
  /** Timestamps to persist when shouldPersist is true. */
  loginAt: number;
  lastActivityAt: number;
  /** True when middleware should re-seal the cookie with refreshed claims. */
  shouldPersist: boolean;
}

function asEpoch(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Pure expiry decision — no I/O, no crypto — so it is fully unit-testable.
 * Enforces the absolute cap first (a hard ceiling that activity cannot extend),
 * then the sliding idle cap.
 */
export function evaluateSession(
  claims: SessionActivityClaims,
  nowSeconds: number,
  opts: { idleSeconds: number; absoluteSeconds: number; slideThrottleSeconds?: number }
): SessionDecision {
  const slideThrottle = opts.slideThrottleSeconds ?? SLIDE_THROTTLE_SECONDS;

  const knownLogin = asEpoch(claims.loginAt);
  const loginAt = knownLogin ?? nowSeconds;
  const knownActivity = asEpoch(claims.lastActivityAt);
  const lastActivityAt = knownActivity ?? nowSeconds;

  // Absolute cap — measured from first authenticated sight, non-extendable.
  if (nowSeconds - loginAt > opts.absoluteSeconds) {
    return { status: "expired", reason: "absolute", loginAt, lastActivityAt, shouldPersist: false };
  }
  // Idle cap — sliding window.
  if (nowSeconds - lastActivityAt > opts.idleSeconds) {
    return { status: "expired", reason: "idle", loginAt, lastActivityAt, shouldPersist: false };
  }

  // Valid. Persist when we just stamped a missing claim or the slide is due.
  const stampedMissing = knownLogin === null || knownActivity === null;
  const slideDue = nowSeconds - lastActivityAt >= slideThrottle;
  return {
    status: "valid",
    loginAt,
    lastActivityAt: nowSeconds,
    shouldPersist: stampedMissing || slideDue,
  };
}

/** Decrypt a sealed session cookie. Returns null on any failure (fail closed). */
export async function unsealSession<T = Record<string, unknown>>(
  raw: string,
  secret: string
): Promise<T | null> {
  try {
    const data = await unsealData<T>(raw, { password: secret });
    if (!data || Object.keys(data as Record<string, unknown>).length === 0) return null;
    return data;
  } catch {
    return null;
  }
}

/** Re-seal a session payload with the same TTL semantics as iron-session issuance. */
export async function sealSession(
  data: Record<string, unknown>,
  secret: string,
  absoluteSeconds: number
): Promise<string> {
  return sealData(data, { password: secret, ttl: absoluteSeconds * 1000 });
}
