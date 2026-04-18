import { getIronSession } from "iron-session";
import { cookies } from "next/headers";

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
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: 60 * 60 * 24 * 7, // 7 days
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
