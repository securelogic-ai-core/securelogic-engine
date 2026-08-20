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

/**
 * Why middleware tore a session down. The first three come from
 * evaluateSession (time-based); the last two come from the ENGINE having
 * rejected the session JWT as no longer valid — a different class of event,
 * kept separate so the login page can explain the right thing.
 *
 *   security_update      — the JWT predates SEC-JWT-EPOCH and carries no `se`
 *                          claim at all. Every session issued before that
 *                          deploy is in this state.
 *   session_invalidated  — the JWT carries an epoch, but the engine says it is
 *                          no longer the user's current one (password reset or
 *                          change, invite reactivation, forced logout).
 */
export type SessionTeardownReason =
  | SessionExpiryReason
  | "security_update"
  | "session_invalidated";

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


/* =========================================================================
   Engine session validity (SEC-JWT-EPOCH, app side)
   =========================================================================

   The app session (this cookie) and the engine session (the JWT inside it) are
   INDEPENDENT. Before this, nothing reconciled them: middleware validated only
   the cookie's own timers, and `engineFetch` had no 401 branch, so a JWT the
   engine had invalidated left the user "signed in" to an app whose every data
   call failed. Pages degrade rather than redirect — `me` comes back null,
   entitlement falls back to "starter" — so the user sees an empty, downgraded
   app instead of a login screen, until the idle cap (30 min) or absolute cap
   (12 h) finally expires the cookie.

   Two checks close that, cheapest first:

     1. The `se` claim is readable from the token itself, with no I/O at all.
        Its ABSENCE is decidable offline and covers the entire deploy event —
        every pre-SEC-JWT-EPOCH session in existence.
     2. A STALE epoch is not decidable offline (only the engine knows the
        user's current value), so it needs one throttled probe.

   Both fail OPEN on anything ambiguous. A forced logout is a destructive act
   against a user's session; we only take it on a definite answer. */

/** How often middleware may ask the engine whether the session still stands. */
export function getEngineProbeSeconds(): number {
  const raw = parseInt(process.env.SESSION_ENGINE_PROBE_SECONDS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 60;
}

/** Hard ceiling on the probe. Middleware is on the critical path of every navigation. */
export const ENGINE_PROBE_TIMEOUT_MS = 2000;

/**
 * The engine error codes that mean "this session can never work again".
 *
 * Deliberately NOT every 401. `invalid_or_expired_token`, `unauthorized` and
 * `api_key_required` are generic authorization failures — signing the user out
 * on those would convert a transient or unrelated fault into a forced logout.
 * `account_inactive` is genuinely terminal too, but it is a membership event
 * with its own product messaging; it is out of scope here and left alone.
 */
export const ENGINE_SESSION_INVALID_ERRORS: ReadonlySet<string> = new Set([
  "session_epoch_missing",
  "session_invalidated",
]);

/** Edge-safe base64url → string. No Buffer (Node-only), no throw. */
function base64UrlDecode(input: string): string | null {
  try {
    const padding = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
    const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + padding;
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export type SessionEpochState = "present" | "absent" | "unreadable";

/**
 * Read the `se` claim WITHOUT verifying the signature — deliberately.
 *
 * This token arrives from our own iron-session cookie, which is already sealed
 * and authenticated; re-verifying the HMAC here would need the engine's
 * JWT_SECRET in the app, which the app must not hold. Nothing is authorized on
 * the strength of this read: "present" grants nothing, it only declines to sign
 * the user out. The engine remains the sole authority on whether the epoch is
 * CORRECT.
 *
 * "unreadable" (not a three-part JWT, undecodable, not JSON) fails OPEN.
 */
export function jwtSessionEpochState(token: unknown): SessionEpochState {
  if (typeof token !== "string") return "unreadable";
  const parts = token.split(".");
  if (parts.length !== 3) return "unreadable";
  const json = base64UrlDecode(parts[1] ?? "");
  if (json === null) return "unreadable";
  try {
    const payload = JSON.parse(json) as Record<string, unknown>;
    return typeof payload.se === "number" ? "present" : "absent";
  } catch {
    return "unreadable";
  }
}

export type EngineSessionVerdict = "valid" | "invalid" | "unknown";

/**
 * Ask the engine whether this JWT still names a live session.
 *
 * Only a 401 carrying one of ENGINE_SESSION_INVALID_ERRORS returns "invalid".
 * Every other outcome — 200, 5xx, a different 401 code, a timeout, a network
 * error, an unset ENGINE_API_URL — returns "unknown" and the caller leaves the
 * session alone. An engine outage must never sign the whole customer base out.
 */
export async function probeEngineSession(token: string): Promise<EngineSessionVerdict> {
  const base = process.env.ENGINE_API_URL;
  if (!base) return "unknown";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENGINE_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: controller.signal,
    });
    // Only a 2xx is affirmative evidence the session stands. A 5xx, a proxy
    // error page or a redirect says nothing about the session and must not be
    // recorded as "valid" — it is simply unknown.
    if (res.ok) return "valid";
    if (res.status !== 401) return "unknown";
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const code = typeof body?.error === "string" ? body.error : null;
    return code !== null && ENGINE_SESSION_INVALID_ERRORS.has(code) ? "invalid" : "unknown";
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}

/** Is a fresh engine probe due for this session yet? */
export function isEngineProbeDue(
  lastCheckedAt: unknown,
  nowSeconds: number,
  probeSeconds: number
): boolean {
  const last = typeof lastCheckedAt === "number" && Number.isFinite(lastCheckedAt)
    ? lastCheckedAt
    : null;
  if (last === null) return true;
  return nowSeconds - last >= probeSeconds;
}
