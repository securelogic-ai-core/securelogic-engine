import { getIronSession } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  apiKey: string;
  organizationId: string;
  organizationName: string;
  entitlementLevel: string;
  billingActive: boolean;
}

export const SESSION_OPTIONS = {
  password: process.env.SESSION_SECRET as string,
  cookieName: "sl_session",
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
};

/**
 * Returns the iron-session for the current request.
 * For use in Server Components and API Routes only.
 */
export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS);
}
