import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { getSessionOptions, type SessionData } from "@/lib/session";
import { authVerifyEmail, getAuthMe } from "@/lib/api";

export async function POST(request: Request) {
  try {
    const body  = (await request.json()) as { token?: unknown };
    const token = typeof body.token === "string" ? body.token.trim() : "";

    if (!token) {
      return NextResponse.json({ error: "missing_token" }, { status: 400 });
    }

    const result = await authVerifyEmail(token);

    if ("error" in result) {
      const status =
        result.error === "token_not_found_or_already_verified" ? 404 :
        result.error === "token_expired" ? 410 : 400;
      return NextResponse.json(result, { status });
    }

    // Persist session so the user lands directly on the app
    const me = await getAuthMe(result.token);
    let onboardingCompleted = false;
    let pendingPlan: "professional" | "teams" | "platform" | "platform_annual" | null = null;

    const cookieStore = await cookies();
    const session = await getIronSession<SessionData>(cookieStore, getSessionOptions());

    if (me) {
      onboardingCompleted = me.onboardingCompleted ?? false;
      session.jwtToken             = result.token;
      session.userId               = me.id;
      session.email                = me.email;
      session.name                 = me.name;
      session.organizationId       = me.organizationId;
      session.organizationName     = me.organizationName;
      session.entitlementLevel     = me.entitlementLevel;
      session.billingActive        = me.billingActive;
      session.onboardingCompleted  = onboardingCompleted;
    }

    // Replay the plan the user picked at /signup, if any. Cleared either way
    // so a stale value cannot be reused.
    if (
      session.pendingPlan === "professional" ||
      session.pendingPlan === "teams" ||
      session.pendingPlan === "platform" ||
      session.pendingPlan === "platform_annual"
    ) {
      pendingPlan = session.pendingPlan;
    }
    delete session.pendingPlan;

    await session.save();

    return NextResponse.json({
      ok: true,
      onboardingCompleted,
      pendingPlan,
      entitlementLevel: me?.entitlementLevel ?? "starter"
    });
  } catch {
    return NextResponse.json({ error: "verification_failed" }, { status: 500 });
  }
}
