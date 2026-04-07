import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { SESSION_OPTIONS, type SessionData } from "@/lib/session";
import { getMe } from "@/lib/api";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { apiKey?: unknown };
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : null;

    if (!apiKey || apiKey.length < 8) {
      return NextResponse.json(
        { error: "api_key_required" },
        { status: 400 }
      );
    }

    // Validate the key against the engine
    const me = await getMe(apiKey);

    if (!me) {
      return NextResponse.json(
        { error: "invalid_api_key" },
        { status: 401 }
      );
    }

    // Persist session
    const cookieStore = await cookies();
    const session = await getIronSession<SessionData>(cookieStore, SESSION_OPTIONS);

    session.apiKey           = apiKey;
    session.organizationId   = me.organizationId;
    session.organizationName = me.organizationName;
    session.entitlementLevel = me.entitlementLevel;
    session.billingActive    = me.billingActive;

    await session.save();

    return NextResponse.json({ ok: true, entitlementLevel: me.entitlementLevel });
  } catch {
    return NextResponse.json(
      { error: "login_failed" },
      { status: 500 }
    );
  }
}
