import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { getSessionOptions, type SessionData } from "@/lib/session";
import { getMe } from "@/lib/api";

/**
 * POST /api/session/refresh
 *
 * Refreshes the iron-session cookie with live account data from the
 * engine. Called after Stripe checkout completes so the dashboard
 * reflects the upgraded entitlement immediately.
 *
 * Supports both JWT auth (jwtToken) and legacy API key auth (apiKey).
 * The engine's /api/me endpoint accepts both via Authorization: Bearer.
 */
export async function POST() {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, getSessionOptions());

  // Support both JWT auth (new) and legacy API key auth
  const token = session.jwtToken ?? session.apiKey ?? null;

  if (!token) {
    return NextResponse.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }

  const me = await getMe(token);

  if (!me) {
    return NextResponse.json({ ok: false, reason: "engine_unavailable" }, { status: 502 });
  }

  session.entitlementLevel = me.entitlementLevel;
  session.billingActive    = me.billingActive;
  session.organizationName = me.organizationName;
  await session.save();

  return NextResponse.json({ ok: true, entitlementLevel: me.entitlementLevel });
}
