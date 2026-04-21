import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { getSessionOptions, type SessionData } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export async function POST(request: Request) {
  const body = await request.json() as { backup_code?: unknown; mfa_token?: unknown };

  const res = await fetch(`${ENGINE_URL}/api/auth/mfa/use-backup`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ backup_code: body.backup_code, mfa_token: body.mfa_token }),
    cache:   "no-store"
  });

  const data = await res.json() as {
    ok?: boolean;
    token?: string;
    error?: string;
    user?: {
      id: string;
      email: string;
      name: string;
      role?: string;
      organizationId: string;
      organizationName: string;
      entitlementLevel: string;
      onboardingCompleted?: boolean;
    };
  };

  if (!res.ok || !data.ok || !data.token || !data.user) {
    return NextResponse.json(data, { status: res.status });
  }

  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, getSessionOptions());

  session.userId              = data.user.id;
  session.email               = data.user.email;
  session.name                = data.user.name;
  session.userRole            = data.user.role ?? "viewer";
  session.jwtToken            = data.token;
  session.organizationId      = data.user.organizationId;
  session.organizationName    = data.user.organizationName;
  session.entitlementLevel    = data.user.entitlementLevel;
  session.billingActive       = data.user.entitlementLevel !== "starter";
  session.onboardingCompleted = data.user.onboardingCompleted ?? false;

  await session.save();

  return NextResponse.json({
    ok:               true,
    entitlementLevel: data.user.entitlementLevel
  });
}
