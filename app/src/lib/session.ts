import { getIronSession } from "iron-session";
import { cookies } from "next/headers";

// Absolute session lifetime. Configurable via SESSION_TIMEOUT_SECONDS env var.
// Default: 8 hours — appropriate for a security platform.
const SESSION_MAX_AGE_SECONDS = parseInt(
  process.env.SESSION_TIMEOUT_SECONDS ?? String(60 * 60 * 8)
);

export interface SessionData {
  // Customer auth (email/password — new)
  userId?: string;
  email?: string;
  name?: string;
  userRole?: string;
  jwtToken?: string;

  // Legacy API-key auth (kept for backward compatibility)
  apiKey?: string;

  // Shared org/entitlement fields (populated by both auth paths)
  organizationId?: string;
  organizationName?: string;
  entitlementLevel?: string;
  billingActive?: boolean;
  onboardingCompleted?: boolean;

  // Pre-auth: paid tier the user picked on /signup, replayed by
  // /verify-email after the email-verification step to redirect into checkout.
  pendingPlan?: "professional" | "team";
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
      maxAge: SESSION_MAX_AGE_SECONDS,
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
