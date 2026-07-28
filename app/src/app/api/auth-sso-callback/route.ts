import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { getSessionOptions, type SessionData } from "@/lib/session";
import { getAuthMe } from "@/lib/api";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    let token  = url.searchParams.get("token")  ?? "";
    let userId = url.searchParams.get("userId") ?? "";
    let email  = url.searchParams.get("email")  ?? "";
    let name   = url.searchParams.get("name")   ?? "";
    let orgId  = url.searchParams.get("orgId")  ?? "";

    // Hardened handoff (SECURELOGIC_SSO_CODE_EXCHANGE_ENABLED on the engine):
    // the URL carries only a single-use code; everything else comes from the
    // server-side exchange, so no token or PII ever transits the browser URL.
    // The legacy token/userId/... query shape above keeps working while the
    // flag is off (deploy-skew safe in either order).
    const code = url.searchParams.get("code") ?? "";
    if (code) {
      const exchangeRes = await fetch(`${ENGINE_URL}/api/sso/exchange`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ code }),
        cache:   "no-store",
      });
      if (!exchangeRes.ok) {
        return NextResponse.redirect(new URL("/login?error=sso_callback_invalid", request.url));
      }
      const exchanged = (await exchangeRes.json()) as {
        token: string; userId: string; email: string; name: string; orgId: string;
      };
      token  = exchanged.token;
      userId = exchanged.userId;
      email  = exchanged.email;
      name   = exchanged.name;
      orgId  = exchanged.orgId;
    }
    name = name || email;

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
