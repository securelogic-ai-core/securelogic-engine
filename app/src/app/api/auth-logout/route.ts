import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { getSessionOptions, type SessionData } from "@/lib/session";

export async function POST() {
  try {
    const cookieStore = await cookies();
    const session = await getIronSession<SessionData>(cookieStore, getSessionOptions());
    session.destroy();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "logout_failed" }, { status: 500 });
  }
}
