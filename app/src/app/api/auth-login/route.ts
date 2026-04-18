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

    // Persist session
    const cookieStore = await cookies();
    const session = await getIronSession<SessionData>(cookieStore, getSessionOptions());

    session.userId               = result.user.id;
    session.email                = result.user.email;
    session.name                 = result.user.name;
    session.userRole             = (result.user as { role?: string }).role ?? "admin";
    session.jwtToken             = result.token;
    session.organizationId       = result.user.organizationId;
    session.organizationName     = result.user.organizationName;
    session.entitlementLevel     = result.user.entitlementLevel;
    session.billingActive        = result.user.entitlementLevel !== "starter";
    session.onboardingCompleted  = result.user.onboardingCompleted ?? false;

    await session.save();

    return NextResponse.json({
      ok: true,
      entitlementLevel: result.user.entitlementLevel
    });
  } catch {
    return NextResponse.json({ error: "login_failed" }, { status: 500 });
  }
}
