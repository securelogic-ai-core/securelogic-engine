import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { getSessionOptions, type SessionData } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      token?: string;
      name?: string;
      password?: string;
    };

    const token    = typeof body.token    === "string" ? body.token.trim()    : "";
    const name     = typeof body.name     === "string" ? body.name.trim()     : "";
    const password = typeof body.password === "string" ? body.password        : "";

    if (!token || !name || !password) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400 });
    }

    const res = await fetch(
      `${ENGINE_URL}/api/team/invites/${encodeURIComponent(token)}/accept`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password }),
        cache: "no-store",
      }
    );

    const data = (await res.json()) as {
      token?: string;
      user?: {
        id: string;
        email: string;
        name: string;
        role: string;
        orgId: string;
      };
      error?: string;
      detail?: string;
    };

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    if (!data.token || !data.user) {
      return NextResponse.json({ error: "invalid_response" }, { status: 500 });
    }

    // Fetch org name via auth/me using the new JWT
    let orgName = "Your Organisation";
    let entitlementLevel = "starter";
    try {
      const meRes = await fetch(`${ENGINE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${data.token}` },
        cache: "no-store",
      });
      if (meRes.ok) {
        const me = (await meRes.json()) as {
          organizationName?: string;
          entitlementLevel?: string;
        };
        orgName          = me.organizationName ?? orgName;
        entitlementLevel = me.entitlementLevel ?? entitlementLevel;
      }
    } catch {
      // non-fatal
    }

    const cookieStore = await cookies();
    const session     = await getIronSession<SessionData>(cookieStore, getSessionOptions());

    session.userId           = data.user.id;
    session.email            = data.user.email;
    session.name             = data.user.name;
    session.userRole         = data.user.role;
    session.jwtToken         = data.token;
    session.organizationId   = data.user.orgId;
    session.organizationName = orgName;
    session.entitlementLevel = entitlementLevel;
    session.billingActive    = entitlementLevel !== "starter";

    await session.save();

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "accept_failed" }, { status: 500 });
  }
}
