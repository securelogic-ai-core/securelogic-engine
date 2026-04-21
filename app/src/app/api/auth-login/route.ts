import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { getSessionOptions, type SessionData } from "@/lib/session";
import { authLogin } from "@/lib/api";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: unknown; password?: unknown };
    const email    = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400 });
    }

    const result = await authLogin(email, password);

    if ("error" in result) {
      const status =
        result.error === "invalid_credentials" ? 401 :
        result.error === "email_not_verified"  ? 403 : 400;
      return NextResponse.json(result, { status });
    }

    // MFA required — pass challenge token through without setting session
    if ("mfa_required" in result && result.mfa_required) {
      return NextResponse.json({ mfa_required: true, mfa_token: result.mfa_token });
    }

    // TypeScript needs explicit narrowing here after three union branches
    const loginResult = result as Extract<typeof result, { ok: true }>;

    // Persist session
    const cookieStore = await cookies();
    const session = await getIronSession<SessionData>(cookieStore, getSessionOptions());

    session.userId               = loginResult.user.id;
    session.email                = loginResult.user.email;
    session.name                 = loginResult.user.name;
    session.userRole             = (loginResult.user as { role?: string }).role ?? "viewer";
    session.jwtToken             = loginResult.token;
    session.organizationId       = loginResult.user.organizationId;
    session.organizationName     = loginResult.user.organizationName;
    session.entitlementLevel     = loginResult.user.entitlementLevel;
    session.billingActive        = loginResult.user.entitlementLevel !== "starter";
    session.onboardingCompleted  = loginResult.user.onboardingCompleted ?? false;

    await session.save();

    return NextResponse.json({
      ok: true,
      entitlementLevel: loginResult.user.entitlementLevel
    });
  } catch {
    return NextResponse.json({ error: "login_failed" }, { status: 500 });
  }
}
