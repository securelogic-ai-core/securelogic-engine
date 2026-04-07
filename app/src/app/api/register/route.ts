import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { getSessionOptions, type SessionData } from "@/lib/session";
import { registerOrg, getMe } from "@/lib/api";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { name?: unknown; email?: unknown };
    const name  = typeof body.name  === "string" ? body.name.trim()  : null;
    const email = typeof body.email === "string" ? body.email.trim() : null;

    if (!name || name.length < 2) {
      return NextResponse.json(
        { error: "Organization name must be at least 2 characters." },
        { status: 400 }
      );
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "A valid email address is required." },
        { status: 400 }
      );
    }

    const result = await registerOrg(name, email);

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }

    // Auto-login: hydrate session with the new API key
    const me = await getMe(result.apiKey);

    if (me) {
      const cookieStore = await cookies();
      const session = await getIronSession<SessionData>(cookieStore, getSessionOptions());

      session.apiKey           = result.apiKey;
      session.organizationId   = me.organizationId;
      session.organizationName = me.organizationName;
      session.entitlementLevel = me.entitlementLevel;
      session.billingActive    = me.billingActive;

      await session.save();
    }

    // Return the raw API key — shown to the user exactly once.
    return NextResponse.json(
      {
        ok:             true,
        apiKey:         result.apiKey,
        organizationId: result.organizationId,
        note:           result.note,
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { error: "Registration failed. Please try again." },
      { status: 500 }
    );
  }
}
