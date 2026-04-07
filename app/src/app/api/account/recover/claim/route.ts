import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { getSessionOptions, type SessionData } from "@/lib/session";
import { claimRecovery, getMe } from "@/lib/api";

/**
 * POST /api/account/recover/claim
 * { token: string }
 *
 * Claims a recovery token from the engine, receives a new API key,
 * hydrates the iron-session, and returns ok so the client can redirect.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { token?: unknown };
    const token = typeof body.token === "string" ? body.token.trim() : "";

    if (!token) {
      return NextResponse.json({ error: "token_required" }, { status: 400 });
    }

    const result = await claimRecovery(token);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.error === "token_not_found_or_expired" ? 404 : 500 }
      );
    }

    // Token is valid — hydrate session with the new API key
    const me = await getMe(result.apiKey);

    if (!me) {
      return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
    }

    const cookieStore = await cookies();
    const session = await getIronSession<SessionData>(cookieStore, getSessionOptions());

    session.apiKey           = result.apiKey;
    session.organizationId   = me.organizationId;
    session.organizationName = me.organizationName;
    session.entitlementLevel = me.entitlementLevel;
    session.billingActive    = me.billingActive;

    await session.save();

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "recovery_failed" }, { status: 500 });
  }
}
