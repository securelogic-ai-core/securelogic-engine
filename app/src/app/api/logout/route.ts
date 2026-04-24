import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { getSessionOptions, type SessionData } from "@/lib/session";
import { engineLogout } from "@/lib/api";
import { getOrigin } from "@/lib/getOrigin";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, getSessionOptions());

  // Notify the engine so the auth.logout audit event fires. Fire-and-forget:
  // sign-out proceeds even if the engine call fails.
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (token) {
    await engineLogout(token);
  }

  session.destroy();

  const origin = getOrigin(request);
  return NextResponse.redirect(`${origin}/login`, { status: 303 });
}
