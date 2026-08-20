import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { getSessionOptions, type SessionData } from "@/lib/session";
import { getAuthMe } from "@/lib/api";
import { getOrigin } from "@/lib/getOrigin";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export async function GET(request: Request) {
  // #823: every redirect below MUST be built against the PUBLIC origin, not
  // against request.url.
  //
  // This route runs in the Node runtime, where `request.url` behind Render's
  // proxy carries the INTERNAL bind address (https://localhost:10000). Resolving
  // a relative path against it produced `https://localhost:10000/dashboard`, so
  // a browser completing SSO was sent to its own machine and the login could not
  // finish — even though the exchange, the session and the cookie were all
  // correct. getOrigin() reads x-forwarded-proto / x-forwarded-host, which is
  // what the three other redirecting handlers (logout, billing/checkout,
  // billing/portal) already do.
  //
  // Middleware deliberately still uses `new URL(..., request.url)`: it runs in
  // the EDGE runtime, where request.url is already the real external URL. This
  // is a Node-runtime-only defect and the fix belongs only here.
  //
  // Resolved before the try so the catch-block redirect below has it too.
  const origin = getOrigin(request);

  try {
    // Query parsing only — reading search params off the internal URL is
    // correct; it is redirect BASES that must not come from it.
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
        return NextResponse.redirect(new URL("/login?error=sso_callback_invalid", origin));
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

    // Kill switch for the legacy token-in-URL shape (security review N1b):
    // once the engine's code-exchange flag is confirmed on everywhere, the
    // operator sets this and the legacy query shape stops planting sessions.
    // The code path above is unaffected.
    if (
      !code &&
      process.env.SECURELOGIC_SSO_LEGACY_CALLBACK_DISABLED === "true"
    ) {
      return NextResponse.redirect(new URL("/login?error=sso_callback_invalid", origin));
    }

    if (!token || !userId || !email || !orgId) {
      return NextResponse.redirect(new URL("/login?error=sso_callback_invalid", origin));
    }

    // Fetch full me response to populate entitlement and org name. HARD-FAIL
    // when the token does not verify (security review N1a): a session must
    // never be planted from an unverified token with attacker-chosen
    // email/name/orgId — getAuthMe null means the engine rejected the token.
    const me = await getAuthMe(token);
    if (!me) {
      return NextResponse.redirect(new URL("/login?error=sso_session_failed", origin));
    }

    const cookieStore = await cookies();
    const session = await getIronSession<SessionData>(cookieStore, getSessionOptions());

    // Identity comes from the VERIFIED token (/api/auth/me), never from the
    // URL — the query params are, at best, a hint the engine already proved
    // and, at worst, attacker-chosen (security review N1). The token itself
    // is the only thing the session may trust.
    session.jwtToken            = token;
    session.userId              = me.id;
    session.email               = me.email;
    session.name                = me.name || me.email;
    session.organizationId      = me.organizationId;
    session.organizationName    = me.organizationName ?? "";
    session.entitlementLevel    = me.entitlementLevel ?? "starter";
    session.userRole            = me.role ?? "analyst";
    session.billingActive       = me.billingActive ?? false;
    session.onboardingCompleted = true; // SSO users skip onboarding

    await session.save();

    return NextResponse.redirect(new URL("/dashboard", origin));
  } catch {
    return NextResponse.redirect(new URL("/login?error=sso_session_failed", origin));
  }
}
