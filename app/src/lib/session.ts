import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { getAbsoluteSeconds } from "@/lib/sessionPolicy";

export interface SessionData {
  // Customer auth (email/password — new)
  userId?: string;
  email?: string;
  name?: string;
  userRole?: string;
  /**
   * Enterprise seat class: full | contributor | viewer. Carried for UI
   * affordance gating (defense in depth). The authoritative resolved scope —
   * capabilities, read/write scope, isAdmin — comes from GET /api/me's `seat`
   * block, which the server computes with the same resolveScope it enforces
   * with. The UI must never treat this as a security boundary.
   */
  seatType?: string;
  jwtToken?: string;

  // Legacy API-key auth (kept for backward compatibility)
  apiKey?: string;

  // Shared org/entitlement fields (populated by both auth paths)
  organizationId?: string;
  organizationName?: string;
  entitlementLevel?: string;
  onboardingCompleted?: boolean;

  // billingActive is DELIBERATELY ABSENT (SL-BILL-1 PR-G, defect D7).
  //
  // It used to be written here by ten routes and read by NOTHING — dead state
  // that was also inconsistent, since half the writers used the engine's
  // payment-failure-aware value and half used `entitlementLevel !== "starter"`,
  // which is a different question.
  //
  // Deleting it rather than unifying it, because a payment-state cache in a
  // cookie is STALE BY CONSTRUCTION: a session minted while billing was healthy
  // would keep claiming billingActive:true for the life of the cookie, long
  // after the card failed. The obvious future temptation — "render the dunning
  // banner from the session and skip the fetch" — would therefore have shown
  // the reassuring answer to precisely the customer PR-A and PR-B exist to
  // warn. Removing the field removes the trap.
  //
  // Authoritative sources, both DB-backed and payment-failure-aware:
  //   GET /api/me and GET /api/auth/me     -> billingActive
  //   GET /api/billing/subscription        -> payment_failed_at (drives the banner)

  // Pre-auth: paid tier the user picked on /signup, replayed by
  // /verify-email after the email-verification step to redirect into checkout.
  pendingPlan?: "professional" | "teams" | "platform" | "platform_annual";

  // Session-timeout enforcement claims (PR-C1). Owned by middleware:
  // loginAt is stamped once (absolute cap), lastActivityAt slides (idle cap).
  loginAt?: number;
  lastActivityAt?: number;

  /**
   * When middleware last asked the ENGINE whether this session's JWT is still
   * valid (SEC-JWT-EPOCH). Owned by middleware; throttles the probe to once per
   * SESSION_ENGINE_PROBE_SECONDS. Declared here so a route handler's
   * session.save() round-trips it instead of dropping it.
   */
  engineCheckedAt?: number;
}

/**
 * SESSION_OPTIONS must be a function — not a module-level constant — so that
 * process.env.SESSION_SECRET is read at request time rather than baked in at
 * build time (which would freeze it as undefined if the var wasn't set during
 * the Render build step).
 */
export function getSessionOptions() {
  return {
    password: process.env.SESSION_SECRET as string,
    cookieName: "sl_session",
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" || process.env.FORCE_SECURE_COOKIE === "true",
      sameSite: "lax" as const,
      // Absolute cookie lifetime — kept in step with the middleware absolute cap
      // (SESSION_ABSOLUTE_SECONDS, legacy fallback SESSION_TIMEOUT_SECONDS, 12 h).
      maxAge: getAbsoluteSeconds(),
    },
  };
}

// Keep a named export for the type, used by API routes that call getIronSession directly.
export type SessionOptions = ReturnType<typeof getSessionOptions>;

/**
 * Returns the iron-session for the current request.
 * For use in Server Components and API Routes only.
 */
export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, getSessionOptions());
}
