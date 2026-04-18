import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { getSessionOptions, type SessionData } from "@/lib/session";
import { getAuthMe } from "@/lib/api";

export async function GET(request: Request) {
  try {
    const url     = new URL(request.url);
    const token   = url.searchParams.get("token")   ?? "";
    const userId  = url.searchParams.get("userId")  ?? "";
    const email   = url.searchParams.get("email")   ?? "";
    const name    = url.searchParams.get("name")    ?? email;
    const orgId   = url.searchParams.get("orgId")   ?? "";

    if (!token || !userId || !email || !orgId) {
      return NextResponse.redirect(new URL("/login?error=sso_callback_invalid", request.url));
    }

    // Fetch full me response to populate entitlement and org name
    const me = await getAuthMe(token);

    const cookieStore = await cookies();
    const session = await getIronSession<SessionData>(cookieStore, getSessionOptions());

    session.jwtToken            = token;
    session.userId              = userId;
    session.email               = email;
    session.name                = name || email;
    session.organizationId      = orgId;
    session.organizationName    = me?.organizationName ?? "";
    session.entitlementLevel    = me?.entitlementLevel ?? "starter";
    session.userRole            = me?.role ?? "analyst";
    session.billingActive       = me?.billingActive ?? false;
    session.onboardingCompleted = true; // SSO users skip onboarding

    await session.save();

    return NextResponse.redirect(new URL("/dashboard", request.url));
  } catch {
    return NextResponse.redirect(new URL("/login?error=sso_session_failed", request.url));
  }
}
