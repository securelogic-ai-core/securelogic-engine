import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { getSessionOptions, type SessionData } from "@/lib/session";
import { getMe } from "@/lib/api";

/**
 * POST /api/session/refresh
 *
 * Refreshes the iron-session cookie with live account data from the
 * engine. Called by the /success page after Stripe checkout completes
 * so the dashboard reflects the upgraded entitlement immediately.
 */
export async function POST() {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, getSessionOptions());

  if (!session.apiKey) {
    return NextResponse.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }

  const me = await getMe(session.apiKey);

  if (!me) {
    return NextResponse.json({ ok: false, reason: "engine_unavailable" }, { status: 502 });
  }

  session.entitlementLevel = me.entitlementLevel;
  session.billingActive    = me.billingActive;
  session.organizationName = me.organizationName;
  await session.save();

  return NextResponse.json({ ok: true, entitlementLevel: me.entitlementLevel });
}
