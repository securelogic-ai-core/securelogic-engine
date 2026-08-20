import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  getSessionSecret,
  getIdleSeconds,
  getAbsoluteSeconds,
  getEngineProbeSeconds,
  evaluateSession,
  unsealSession,
  sealSession,
  jwtSessionEpochState,
  isEngineProbeDue,
  probeEngineSession,
  type SessionTeardownReason,
} from "@/lib/sessionPolicy";

/**
 * Server-side session enforcement for the entire app.
 *
 * PR-C1: enforcement is page-agnostic by construction — the matcher runs on
 * every route except API handlers, Next internals, and static files, and this
 * function treats everything outside PUBLIC_PREFIXES as authenticated. There is
 * no per-page/per-layout opt-in, so a route can never silently ship unprotected
 * (the bug in the previous presence-only, allowlist-based guard).
 *
 * It decrypts the iron-session cookie in the edge runtime (iron-session v8 runs
 * on Web Crypto), enforces both an idle and an absolute timeout, fails closed on
 * any missing/invalid/expired state, and slides the idle window on activity.
 */

// Unauthenticated routes. Everything else requires a live session.
const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/accept-invite",
  "/recover",
  "/pricing",
  // External vendor portal: authenticated by its own httpOnly cookie
  // (sl_vendor_portal, enforced by the engine), never by an app session.
  "/portal",
];

function isPublicPath(pathname: string): boolean {
  // App root self-redirects to /login; don't guard it (avoids a redirect loop).
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function expiredRedirect(request: NextRequest, reason: SessionTeardownReason): NextResponse {
  const url = new URL("/login", request.url);
  // "idle" gets its own copy; "absolute"/"invalid" surface as a generic expiry.
  // The two engine-invalidation reasons pass through verbatim so the login page
  // can explain WHY — "a security update" reads very differently from "your
  // password was changed", and a user who did neither deserves the true one.
  const param =
    reason === "idle" ? "idle" :
    reason === "security_update" ? "security_update" :
    reason === "session_invalidated" ? "session_invalidated" :
    "expired";
  url.searchParams.set("reason", param);
  const { pathname, search } = request.nextUrl;
  if (pathname !== "/") url.searchParams.set("redirect", pathname + search);
  const res = NextResponse.redirect(url);
  // Clear the stale cookie so the browser stops replaying it.
  res.cookies.delete(SESSION_COOKIE_NAME);
  return res;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const secret = getSessionSecret();
  // Ops guard: without a configured secret, no session can be validated. Fail
  // OPEN here — a missing secret is a server misconfiguration, not a user-session
  // fault, and failing closed would lock out every user with no recovery path.
  // (SESSION_SECRET is set in every real environment, so this branch is inert.)
  if (!secret || secret.length < 32) return NextResponse.next();

  const raw = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) return expiredRedirect(request, "invalid");

  const claims = await unsealSession<Record<string, unknown>>(raw, secret);
  if (!claims) return expiredRedirect(request, "invalid");

  // Only JWT or legacy API-key sessions are authenticated.
  if (!claims.jwtToken && !claims.apiKey) return expiredRedirect(request, "invalid");

  const now = Math.floor(Date.now() / 1000);
  const decision = evaluateSession(claims, now, {
    idleSeconds: getIdleSeconds(),
    absoluteSeconds: getAbsoluteSeconds(),
  });

  if (decision.status === "expired") {
    return expiredRedirect(request, decision.reason ?? "invalid");
  }

  // ── Engine session reconciliation (SEC-JWT-EPOCH) ────────────────────────
  //
  // Everything above validates the APP cookie's own timers. It says nothing
  // about whether the ENGINE still honours the JWT inside it. Without this
  // block a user whose engine session was invalidated keeps a valid cookie,
  // sails past middleware, and lands on a page whose every engine call 401s —
  // rendering an empty, entitlement-downgraded app that still claims they are
  // signed in. Reconcile the two here, where the cookie can actually be
  // cleared (a server component cannot write cookies).
  //
  // Legacy API-key sessions carry no JWT and no epoch; they are untouched.
  const jwtToken = typeof claims.jwtToken === "string" ? claims.jwtToken : null;
  let engineCheckedAt = claims.engineCheckedAt;

  if (jwtToken) {
    // 1. Offline, zero-I/O: a token minted before SEC-JWT-EPOCH has no `se`
    //    claim. This is the whole deploy blast radius and costs nothing.
    if (jwtSessionEpochState(jwtToken) === "absent") {
      return expiredRedirect(request, "security_update");
    }

    // 2. A STALE epoch is only knowable from the engine — one throttled probe.
    //    Anything short of a definite "invalid" leaves the session alone.
    if (isEngineProbeDue(engineCheckedAt, now, getEngineProbeSeconds())) {
      const verdict = await probeEngineSession(jwtToken);
      if (verdict === "invalid") {
        return expiredRedirect(request, "session_invalidated");
      }
      // Stamp on "unknown" too, so an engine outage cannot turn every
      // navigation into another doomed probe on the critical path.
      engineCheckedAt = now;
    }
  }

  const probeStamped = engineCheckedAt !== claims.engineCheckedAt;

  if (decision.shouldPersist || probeStamped) {
    const resealed = await sealSession(
      {
        ...claims,
        loginAt: decision.loginAt,
        lastActivityAt: decision.lastActivityAt,
        engineCheckedAt,
      },
      secret,
      getAbsoluteSeconds()
    );
    const res = NextResponse.next();
    res.cookies.set(SESSION_COOKIE_NAME, resealed, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" || process.env.FORCE_SECURE_COOKIE === "true",
      sameSite: "lax",
      maxAge: getAbsoluteSeconds(),
      path: "/",
    });
    return res;
  }

  return NextResponse.next();
}

export const config = {
  // Run on every route except API handlers, Next internals, and files with an
  // extension. Enforcement scope is decided in-function via PUBLIC_PREFIXES.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
